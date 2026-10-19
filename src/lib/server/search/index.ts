import "server-only";
import { TtlCache } from "../cache";
import { config } from "../config";
import { recordUsage } from "../usage";
import { brave } from "./brave";
import { geminiGrounding } from "./geminiGrounding";
import { mockSearch } from "./mock";
import { tavily } from "./tavily";
import { SearchError, type SearchOptions, type SearchProvider, type SearchResult } from "./types";
import { wikipedia } from "./wikipedia";

export * from "./types";

/** Providers to try, in order. The first one that returns results wins. */
export function searchChain(): SearchProvider[] {
  const c = config();
  if (c.providerMode === "mock" || c.searchProvider === "mock") return [mockSearch];
  const all: Record<string, SearchProvider | null> = {
    tavily: c.tavilyKey ? tavily(c.tavilyKey) : null,
    brave: c.braveKey ? brave(c.braveKey) : null,
    gemini: c.geminiKey && (c.searchProvider === "gemini" || process.env.GEMINI_SEARCH_GROUNDING === "true") ? geminiGrounding : null,
    wikipedia: wikipedia(),
  };
  const order = c.searchProvider === "auto" ? ["tavily", "brave", "gemini", "wikipedia"] : [c.searchProvider, "wikipedia"];
  return [...new Set(order)].map((id) => all[id]).filter((p): p is SearchProvider => !!p);
}

const cache = new TtlCache<{ provider: string; mock: boolean; results: SearchResult[] }>(300, 15 * 60_000);

export interface SearchOutcome {
  provider: string;
  mock: boolean;
  results: SearchResult[];
  failures: { provider: string; message: string }[];
  cached: boolean;
}

export async function webSearch(query: string, opts: SearchOptions & { userId?: string | null } = {}): Promise<SearchOutcome> {
  const key = `${query.toLowerCase().trim()}|${opts.recency ?? ""}|${opts.max ?? ""}`;
  const hit = cache.get(key);
  if (hit) return { ...hit, failures: [], cached: true };

  const failures: SearchOutcome["failures"] = [];
  for (const provider of searchChain()) {
    const t0 = Date.now();
    try {
      const results = await provider.search(query, opts);
      await recordUsage(opts.userId ?? null, "search", provider.id, { latencyMs: Date.now() - t0, detail: { results: results.length } });
      if (results.length) {
        const out = { provider: provider.id, mock: provider.mock, results };
        // Recent-news searches go stale quickly.
        cache.set(key, out, opts.recency === "day" ? 5 * 60_000 : undefined);
        return { ...out, failures, cached: false };
      }
      failures.push({ provider: provider.id, message: "no results" });
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      const message = e instanceof SearchError ? e.message : "unexpected error";
      failures.push({ provider: provider.id, message });
      await recordUsage(opts.userId ?? null, "search_failure", provider.id, { detail: { query: query.slice(0, 200), message } });
    }
  }
  return { provider: "none", mock: false, results: [], failures, cached: false };
}

export function clearSearchCacheForTests() {
  cache.clear();
}
