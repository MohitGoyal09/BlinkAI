import { describe, expect, it } from "bun:test";
import { filterComposioDuplicates } from "../mcp-dedup";

describe("mcp dedup", () => {
  it("keeps exa MCP server available", () => {
    const filtered = filterComposioDuplicates({
      exa: { exa_search: {} },
      github: { github_list_repos: {} },
      custom_research: { fetch_web: {} },
    });

    expect(filtered.exa).toBeDefined();
    expect(filtered.github).toBeUndefined();
    expect(filtered.custom_research).toBeDefined();
  });
});

