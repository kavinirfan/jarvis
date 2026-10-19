import "server-only";
import { webSearch, type Recency, type SearchResult } from "../search";
import { credibility, rankResults, type CredibilityLabel } from "./credibility";
import { extractPage } from "./extract";
import { dedupe, hostname } from "./urls";

/** One numbered piece of evidence shown to the model and, as a citation, to the user. */
export interface Source {
  n: number;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  publishedAt?: string;
  provider: string;
  credibility: CredibilityLabel;
  credibilityReason: string;
  /** "read": the page text was fetched; otherwise only the search snippet was available. */
  access: "read" | "snippet_only";
  accessNote?: string;
  mock: boolean;
  /** Evidence text given to the model (not sent to the client). */
  evidence: string;
}

export type PublicSource = Omit<Source, "evidence">;

export interface ResearchProgress {
  (event: { stage: "searching"; query: string } | { stage: "reading"; title: string; url: string } | { stage: "search_failed"; provider: string; message: string }): void;
}

export interface ResearchResult {
  sources: Source[];
  queries: string[];
  providers: string[];
  failures: { provider: string; message: string }[];
  mock: boolean;
}

const EVIDENCE_CHARS = 3500;

/** Picks the passages of a page most related to the question (simple keyword overlap). */
export function relevantPassages(text: string, question: string, maxChars = EVIDENCE_CHARS): string {
  const terms = new Set(question.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
  const paras = text.split("\n").filter((p) => p.length > 40);
  if (!terms.size || paras.length < 4) return text.slice(0, maxChars);
  const scored = paras.map((p, i) => {
    const words = p.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
    const hits = words.filter((w) => terms.has(w)).length;
    return { p, i, s: hits / Math.sqrt(words.length + 1) + (i < 3 ? 0.3 : 0) };
  });
  const picked: typeof scored = [];
  let used = 0;
  for (const x of [...scored].sort((a, b) => b.s - a.s)) {
    if (used + x.p.length > maxChars) continue;
    picked.push(x);
    used += x.p.length;
  }
  return picked.sort((a, b) => a.i - b.i).map((x) => x.p).join("\n");
}

export async function research(
  question: string,
  queries: string[],
  opts: { recency?: Recency; maxSources: number; pagesToRead: number; userId: string | null; signal?: AbortSignal; onProgress?: ResearchProgress },
): Promise<ResearchResult> {
  const all: SearchResult[] = [];
  const providers = new Set<string>();
  const failures: ResearchResult["failures"] = [];
  let mock = false;

  const outcomes = await Promise.all(
    queries.map(async (q) => {
      opts.onProgress?.({ stage: "searching", query: q });
      return webSearch(q, { recency: opts.recency, max: 6, userId: opts.userId, signal: opts.signal });
    }),
  );
  for (const o of outcomes) {
    all.push(...o.results);
    if (o.results.length) providers.add(o.provider);
    mock ||= o.mock;
    for (const f of o.failures) {
      failures.push(f);
      opts.onProgress?.({ stage: "search_failed", provider: f.provider, message: f.message });
    }
  }

  const ranked = rankResults(dedupe(all), !!opts.recency, Date.now(), question).slice(0, opts.maxSources);

  // Read the top pages in parallel; fall back to snippets for the rest or on failure.
  const pages = await Promise.all(
    ranked.map(async (r, i) => {
      if (mock || i >= opts.pagesToRead) return null;
      opts.onProgress?.({ stage: "reading", title: r.title, url: r.url });
      return extractPage(r.url, opts.signal);
    }),
  );

  const sources: Source[] = ranked.map((r, i) => {
    const page = pages[i];
    const cred = credibility(r.url);
    const read = page?.status === "ok";
    const notes: Record<string, string> = {
      paywalled: "Paywalled or login required: only the search snippet was used.",
      blocked_by_robots: "The site disallows automated reading: only the search snippet was used.",
      unsupported: "Not a readable web page: only the search snippet was used.",
      failed: "Couldn't load the page: only the search snippet was used.",
    };
    return {
      n: i + 1,
      title: (page?.title || r.title).slice(0, 200),
      url: r.url,
      domain: hostname(r.url),
      snippet: r.snippet.slice(0, 400),
      publishedAt: r.publishedAt ?? page?.publishedAt,
      provider: r.provider,
      credibility: cred.label,
      credibilityReason: cred.reason,
      access: read ? "read" : "snippet_only",
      accessNote: page && !read ? notes[page.status] : undefined,
      mock: r.provider === "mock",
      evidence: read ? relevantPassages(page!.text, question) : r.snippet,
    };
  });

  return { sources, queries, providers: [...providers], failures, mock };
}

export function toPublic(s: Source): PublicSource {
  const { evidence: _evidence, ...rest } = s;
  void _evidence;
  return rest;
}

/** Formats sources as clearly-delimited untrusted evidence for the model. */
export function formatEvidence(sources: Source[]): string {
  return sources
    .map(
      (s) =>
        `<source n="${s.n}" domain="${s.domain}" credibility="${s.credibility}" access="${s.access}"${s.publishedAt ? ` published="${s.publishedAt}"` : ""}>\n` +
        `Title: ${s.title}\n${s.evidence.replace(/<\/?source[^>]*>/gi, "")}\n</source>`,
    )
    .join("\n\n");
}

/** Keeps only citations that refer to real sources; reports the rest. */
export function validateCitations(text: string, sourceCount: number): { text: string; cited: number[]; invalid: number[] } {
  const cited = new Set<number>();
  const invalid = new Set<number>();
  const out = text.replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (_m, list: string) => {
    const ok = list
      .split(",")
      .map((x) => Number(x.trim()))
      .filter((n) => {
        const valid = Number.isInteger(n) && n >= 1 && n <= sourceCount;
        (valid ? cited : invalid).add(n);
        return valid;
      });
    return ok.length ? `[${ok.join(", ")}]` : "";
  });
  return { text: out, cited: [...cited].sort((a, b) => a - b), invalid: [...invalid] };
}
