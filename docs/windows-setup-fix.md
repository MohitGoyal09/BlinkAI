# Windows Setup Fix for Coworker

## Issues Identified

### 1. Symlink Permission Error (EPERM)
**Error:** `EPERM: operation not permitted, symlink 'C:\Users\HP\.claude\skills\expo-cicd-workflows\scripts\fetch.js' -> 'D:\code\ai\coworker\data\workspace\.bin\fetch.js'`

**Cause:** Windows requires special permissions to create symbolic links.

### 2. Missing Unix Commands (lsof, xargs)
**Error:** `bun: command not found: lsof` and `bun: command not found: xargs`

**Cause:** These Unix utilities don't exist on Windows.

---

## Solutions

### Solution 1: Enable Windows Developer Mode (Recommended)

This allows non-admin symlinks:

1. **Open Settings** → **System** → **For developers**
2. **Enable "Developer Mode"**
3. **Restart your terminal**
4. **Retry:** `bun run dev`

### Solution 2: Run as Administrator

1. **Close VS Code**
2. **Right-click VS Code** → **Run as administrator**
3. **Retry:** `bun run dev`

### Solution 3: Use PowerShell with Elevated Permissions

```powershell
# Run PowerShell as Administrator, then:
$policy = Get-ExecutionPolicy
Set-ExecutionPolicy RemoteSigned -Scope Process
# Then navigate and run: bun run dev
```

---

## Quick Fix Applied

I've updated `package.json` to use Windows-compatible commands:

**Before (Unix-only):**
```json
"predev": "lsof -ti :4111 | xargs kill -9 2>/dev/null || true;"
```

**After (Windows-compatible):**
```json
"predev": "node -e \"const {exec} = require('child_process'); exec('netstat -ano | findstr :4111', (err, stdout) => { if(stdout) { const pid = stdout.trim().split(/\\s+/).pop(); if(pid) exec('taskkill /F /PID ' + pid); } });\" 2>nul || exit 0"
```

---

## Alternative: Bypass Predev Script

If you continue having issues, bypass the predev:

```bash
# Kill any existing processes manually first
taskkill /F /IM node.exe 2>nul

# Run directly without predev
bun run dev:win
```

Or create a Windows-specific script in `package.json`:

```json
"dev:win": "mastra dev",
"dev:win:kill": "taskkill /F /IM node.exe 2>nul || exit 0 && mastra dev"
```

---

## Troubleshooting the Symlink Error

If the symlink error persists after enabling Developer Mode:

### Option A: Disable Skills Symlinks (if not needed)

Check if `.mastra` directory exists and clean it:

```bash
cd d:/code/ai/coworker
rm -rf .mastra
rm -rf data/workspace/.bin
mkdir -p data/workspace/.bin
bun run dev
```

### Option B: Use WSL2 (Best for Unix compatibility)

If Windows keeps causing issues:

1. **Install WSL2:**
   ```powershell
   wsl --install
   ```

2. **Install Ubuntu** from Microsoft Store

3. **Setup in WSL:**
   ```bash
   # In WSL terminal
   cd /mnt/d/code/ai/coworker
   bun install
   bun run dev
   ```

### Option C: Docker Setup

Use the existing Docker configuration:

```bash
cd d:/code/ai/coworker
docker compose up
```

---

## Verify Your Environment

Check that everything is installed correctly:

```bash
# Check bun
bun --version  # Should be 1.0+

# Check Node
node --version  # Should be 22+

# Check Mastra CLI
npx mastra --version

# Verify .env exists
ls .env  # Should exist (copy from .env.example if not)
```

---

## Next Steps

1. **Try first:** Enable Windows Developer Mode and retry `bun run dev`
2. **If still failing:** Use the `bun run dev:win` command (bypasses predev)
3. **If symlink errors persist:** Consider WSL2 or Docker

## Expected Output When Working

```
[Mastra CLI] Starting Mastra Studio...
[Mastra CLI] Server running at http://localhost:4111
```

Then open http://localhost:4111 in your browser.
