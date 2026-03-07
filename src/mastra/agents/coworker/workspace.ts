import {
  Workspace,
  LocalFilesystem,
  LocalSandbox,
} from "@mastra/core/workspace";
import type { RequestContext } from "@mastra/core/request-context";
import path from "path";
import fs from "fs";
import os from "os";
import { WORKSPACE_PATH } from '../../config/paths';
import { agentConfig } from '../../config/agent-config';

// Auto-create essential directories (Docker entrypoint does this too, but needed for local dev)
fs.mkdirSync(path.join(WORKSPACE_PATH, '.agents', 'skills'), { recursive: true });
fs.mkdirSync(path.join(WORKSPACE_PATH, '.bin'), { recursive: true });

/**
 * Collect skill directories from multiple locations.
 * Deduplicates via realpathSync to handle symlinks from `npx skills add`.
 * Gracefully handles permission errors by skipping inaccessible directories.
 */
function collectSkillPaths(): string[] {
  const candidates = [
    path.join(WORKSPACE_PATH, '.agents', 'skills'),    // Mastra marketplace installs here
    path.join(WORKSPACE_PATH, '.coworker', 'skills'),  // project-local
    path.join(WORKSPACE_PATH, '.claude', 'skills'),    // Claude Code compatible
    path.join(os.homedir(), '.coworker', 'skills'),    // user-global
    path.join(os.homedir(), '.claude', 'skills'),      // user-global
  ];
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const p of candidates) {
    try {
      const real = fs.realpathSync(p);
      if (!seen.has(real) && fs.statSync(real).isDirectory()) {
        // Verify we have read permission by trying to read the directory contents
        try {
          fs.readdirSync(real);
          seen.add(real);
          paths.push(real);
        } catch (permErr: any) {
          if (permErr?.code === 'EACCES' || permErr?.code === 'EPERM') {
            console.warn(`[WorkspaceSkills] Permission denied accessing skills directory: ${real} — skipping`);
          } else {
            // Other errors (e.g., directory removed between stat and readdir) — silently skip
          }
        }
      }
    } catch { /* doesn't exist yet — skip */ }
  }
  return paths;
}

/** Pre-computed at startup; exported for sync-skills-bin route */
export const skillPaths = collectSkillPaths();

/**
 * Sync skill scripts into .bin/ directory.
 * - Strips .sh/.bash extensions so `search.sh` becomes `.bin/search`
 * - chmod +x on source scripts
 * - First-found wins for name collisions
 * Gracefully handles permission errors by skipping inaccessible directories.
 */
export function syncSkillsBin(): number {
  const binDir = path.join(WORKSPACE_PATH, '.bin');
  fs.mkdirSync(binDir, { recursive: true });
  // Remove old SKILL symlinks only (preserve non-skill symlinks like agent-browser)
  try {
    for (const f of fs.readdirSync(binDir)) {
      const p = path.join(binDir, f);
      try {
        if (!fs.lstatSync(p).isSymbolicLink()) continue;
        const target = fs.readlinkSync(p);
        if (skillPaths.some(sp => target.startsWith(sp))) fs.unlinkSync(p);
      } catch {}
    }
  } catch (err: any) {
    if (err?.code === 'EACCES' || err?.code === 'EPERM') {
      console.warn(`[syncSkillsBin] Permission denied reading bin directory: ${binDir}`);
    }
  }
  // Create fresh symlinks from all skill directories
  let linked = 0;
  for (const skillsDir of skillPaths) {
    if (!fs.existsSync(skillsDir)) continue;
    let skillEntries: string[] = [];
    try {
      skillEntries = fs.readdirSync(skillsDir);
    } catch (err: any) {
      if (err?.code === 'EACCES' || err?.code === 'EPERM') {
        console.warn(`[syncSkillsBin] Permission denied reading skills directory: ${skillsDir} — skipping`);
      }
      continue;
    }
    for (const skill of skillEntries) {
      const scriptsDir = path.join(skillsDir, skill, 'scripts');
      if (!fs.existsSync(scriptsDir)) continue;
      let scriptEntries: string[] = [];
      try {
        scriptEntries = fs.readdirSync(scriptsDir);
      } catch (err: any) {
        if (err?.code === 'EACCES' || err?.code === 'EPERM') {
          console.warn(`[syncSkillsBin] Permission denied reading scripts directory: ${scriptsDir} — skipping`);
        }
        continue;
      }
      for (const script of scriptEntries) {
        const src = path.join(scriptsDir, script);
        try {
          if (!fs.statSync(src).isFile()) continue;
        } catch {
          continue;
        }
        // Strip .sh/.bash extension for cleaner command names
        const destName = script.replace(/\.(sh|bash)$/, '');
        const dest = path.join(binDir, destName);
        // Skip if already linked (first-found wins for name collisions)
        if (fs.existsSync(dest)) continue;
        // Ensure source is executable
        try { fs.chmodSync(src, 0o755); } catch {}
        try {
          fs.symlinkSync(src, dest);
          linked++;
        } catch {
          // Skip if symlink creation fails (e.g., permission issues)
        }
      }
    }
  }
  return linked;
}

// Sync skill scripts into .bin/ at startup
syncSkillsBin();

export function getDynamicWorkspace({ requestContext }: { requestContext: RequestContext }) {
  const detection = LocalSandbox.detectIsolation();
  const userEnv = agentConfig.getSandboxEnv();

  return new Workspace({
    id: 'coworker-workspace',
    name: 'Coworker Workspace',
    filesystem: new LocalFilesystem({
      basePath: WORKSPACE_PATH,
      allowedPaths: skillPaths,
    }),
    sandbox: new LocalSandbox({
      workingDirectory: WORKSPACE_PATH,
      env: {
        PATH: `${WORKSPACE_PATH}/.bin:${process.env.PATH}`,
        HOME: WORKSPACE_PATH,
        PORT: process.env.PORT || '4111',
        ...(process.env.PLAYWRIGHT_BROWSERS_PATH && {
          PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH,
        }),
        ...userEnv,
      },
      isolation: detection.available ? detection.backend : "none",
      nativeSandbox: {
        allowNetwork: true,
        allowSystemBinaries: true,
        readWritePaths: [WORKSPACE_PATH, ...skillPaths],
      },
    }),
    ...(skillPaths.length > 0 ? { skills: skillPaths } : {}),
    bm25: true,
  });
}
