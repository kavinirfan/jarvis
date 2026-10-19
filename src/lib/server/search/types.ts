export type Recency = "day" | "week" | "month" | "year";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  /** Which provider returned it. */
  provider: string;
}

export interface SearchOptions {
  max?: number;
  recency?: Recency;
  signal?: AbortSignal;
}

export interface SearchProvider {
  id: string;
  mock: boolean;
  search(query: string, opts: SearchOptions): Promise<SearchResult[]>;
}

export class SearchError extends Error {
  constructor(
    public provider: string,
    message: string,
    public retryable = true,
  ) {
    super(message);
  }
}
