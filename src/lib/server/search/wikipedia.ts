import { fetchJson } from "./http";
import type { SearchProvider } from "./types";

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

/**
 * Keyless search over Wikipedia via the official MediaWiki API. Reliable for background and
 * encyclopedic facts; weak for breaking news, which is why a web-search key is recommended.
 */
export function wikipedia(lang = "en"): SearchProvider {
  return {
    id: "wikipedia",
    mock: false,
    async search(query, { max = 5, signal }) {
      // MediaWiki search doesn't understand web-search operators; strip them.
      const plain = query.replace(/\bsite:\S+/gi, " ").replace(/\bOR\b/g, " ").replace(/["()]/g, " ").replace(/\s+/g, " ").trim() || query;
      const params = new URLSearchParams({
        action: "query",
        list: "search",
        srsearch: plain,
        srlimit: String(max),
        format: "json",
        utf8: "1",
        origin: "*",
      });
      const data = await fetchJson<{ query?: { search?: { title: string; snippet: string; timestamp: string }[] } }>(
        "wikipedia",
        `https://${lang}.wikipedia.org/w/api.php?${params}`,
        { signal },
      );
      return (data.query?.search ?? []).map((r) => ({
        title: `${r.title} - Wikipedia`,
        url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, "_"))}`,
        snippet: decode(r.snippet),
        publishedAt: r.timestamp,
        provider: "wikipedia",
      }));
    },
  };
}
