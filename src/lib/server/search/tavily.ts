import { fetchJson } from "./http";
import type { SearchProvider } from "./types";

/** https://docs.tavily.com — search API built for AI agents. */
export function tavily(apiKey: string): SearchProvider {
  return {
    id: "tavily",
    mock: false,
    async search(query, { max = 6, recency, signal }) {
      const data = await fetchJson<{ results?: { title: string; url: string; content: string; published_date?: string }[] }>(
        "tavily",
        "https://api.tavily.com/search",
        {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            query,
            max_results: max,
            search_depth: "basic",
            topic: recency === "day" || recency === "week" ? "news" : "general",
            ...(recency ? { time_range: recency } : {}),
          }),
          signal,
        },
      );
      return (data.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content, publishedAt: r.published_date, provider: "tavily" }));
    },
  };
}
