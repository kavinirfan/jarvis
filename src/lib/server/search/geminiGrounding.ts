import { describeGeminiError, geminiFetch } from "../llm/gemini";
import { config } from "../config";
import { SearchError, type SearchProvider } from "./types";

/**
 * Google Search through Gemini's grounding tool. Returns the pages Gemini actually retrieved.
 * Not available on every Gemini plan (free-tier keys often get a 429 quota error), so it is only
 * used when SEARCH_PROVIDER=gemini or GEMINI_SEARCH_GROUNDING=true.
 */
export const geminiGrounding: SearchProvider = {
  id: "gemini",
  mock: false,
  async search(query, { max = 6, signal }) {
    const res = await geminiFetch(
      `models/${encodeURIComponent(config().models.fast)}:generateContent`,
      {
        contents: [{ role: "user", parts: [{ text: `Search the web for: ${query}\nSummarize the most relevant findings briefly.` }] }],
        tools: [{ google_search: {} }],
      },
      signal,
      20_000,
    );
    if (!res.ok) throw new SearchError("gemini", describeGeminiError(res.status, "").message);
    const data = (await res.json()) as {
      candidates?: {
        groundingMetadata?: {
          groundingChunks?: { web?: { uri: string; title?: string } }[];
          groundingSupports?: { segment?: { text?: string }; groundingChunkIndices?: number[] }[];
        };
      }[];
    };
    const gm = data.candidates?.[0]?.groundingMetadata;
    const chunks = gm?.groundingChunks ?? [];
    const snippets = new Map<number, string[]>();
    for (const s of gm?.groundingSupports ?? []) {
      for (const i of s.groundingChunkIndices ?? []) {
        if (s.segment?.text) snippets.set(i, [...(snippets.get(i) ?? []), s.segment.text]);
      }
    }
    return chunks
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.web?.uri)
      .slice(0, max)
      .map(({ c, i }) => ({
        title: c.web!.title ?? c.web!.uri,
        url: c.web!.uri,
        snippet: (snippets.get(i) ?? []).join(" ").slice(0, 500),
        provider: "gemini",
      }));
  },
};
