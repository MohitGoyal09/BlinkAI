/**
 * Web search via Exa (same API as Rowboat’s `research-search` builtin).
 * Brave was intentionally omitted — paid API; Exa-only keeps one billable provider.
 */
import { z } from "zod";
import { createTool } from "@mastra/core/tools";
import { getExaApiKey } from "../../config/search-keys";

export const researchSearchTool = createTool({
  id: "research_search",
  description:
    "Web search via Exa (neural / semantic). Returns titles, URLs, article text snippets, highlights, and metadata. Use for quick facts, news, papers, companies, and in-depth research. Prefer one search at a time; add a second only if results are insufficient. If not configured, fall back to Composio FIRECRAWL_SEARCH.",
  inputSchema: z.object({
    query: z.string().describe("Search query"),
    numResults: z.number().optional().describe("Number of results (default 5, max 20)"),
    category: z
      .enum([
        "company",
        "research paper",
        "news",
        "tweet",
        "personal site",
        "financial report",
        "people",
      ])
      .optional()
      .describe("Optional Exa category filter"),
  }),
  execute: async ({ query, numResults, category }) => {
    const apiKey = await getExaApiKey();
    if (!apiKey) {
      return {
        success: false,
        error:
          "Exa Search is not configured. Set EXA_API_KEY or create $DATA_PATH/config/exa-search.json with { \"apiKey\": \"...\" } (see docs/TOOLS.md).",
      };
    }

    const resultCount = Math.min(Math.max(numResults ?? 5, 1), 20);

    const body: Record<string, unknown> = {
      query,
      numResults: resultCount,
      type: "auto",
      contents: {
        text: { maxCharacters: 1000 },
        highlights: true,
      },
    };
    if (category) body.category = category;

    const response = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        success: false,
        error: `Exa Search API error (${response.status}): ${text}`,
      };
    }

    const data = (await response.json()) as {
      results?: Array<{
        title?: string;
        url?: string;
        publishedDate?: string;
        author?: string;
        highlights?: string[];
        text?: string;
      }>;
    };

    const results = (data.results || []).map((r) => ({
      title: r.title || "",
      url: r.url || "",
      publishedDate: r.publishedDate || "",
      author: r.author || "",
      highlights: r.highlights || [],
      text: r.text || "",
    }));

    return {
      success: true,
      query,
      results,
      count: results.length,
    };
  },
});
