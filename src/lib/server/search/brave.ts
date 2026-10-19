import { fetchJson } from "./http";
import type { SearchProvider } from "./types";

const FRESHNESS = { day: "pd", week: "pw", month: "pm", year: "py" } as const;

/** https://api.search.brave.com — independent web index. */
export function brave(apiKey: string): SearchProvider {
  return {
    id: "brave",
    mock: false,
    async search(query, { max = 6, recency, signal }) {
      const params = new URLSearchParams({ q: query, count: String(max), safesearch: "moderate" });
      if (recency) params.set("freshness", FRESHNESS[recency]);
      const data = await fetchJson<{ web?: { results?: { title: string; url: string; description: string; page_age?: string; age?: string }[] } }>(
        "brave",
        `https://api.search.brave.com/res/v1/web/search?${params}`,
        { headers: { "x-subscription-token": apiKey }, signal },
      );
      return (data.web?.results ?? []).map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.description.replace(/<[^>]+>/g, ""),
        publishedAt: r.page_age,
        provider: "brave",
      }));
    },
  };
}
