import type { SearchProvider } from "./types";

/**
 * Test-only provider. Results point at example.com and are flagged as mock so the UI and the
 * answer both say they are not real sources. Never used when a real provider is configured.
 */
export const mockSearch: SearchProvider = {
  id: "mock",
  mock: true,
  async search(query, { max = 3 }) {
    return Array.from({ length: Math.min(max, 3) }, (_, i) => ({
      title: `[MOCK] Result ${i + 1} for "${query}"`,
      url: `https://example.com/mock/${i + 1}?q=${encodeURIComponent(query)}`,
      snippet: `[MOCK] Placeholder text ${i + 1} about ${query}. This is not a real source.`,
      provider: "mock",
    }));
  },
};
