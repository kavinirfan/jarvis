import { hostname } from "./urls";

/**
 * A transparent, rule-based credibility prior. It is a ranking hint, not a verdict: the answer
 * still cross-checks claims across sources and reports disagreement.
 */
const HIGH = [
  "wikipedia.org", "britannica.com", "reuters.com", "apnews.com", "bbc.co.uk", "bbc.com", "nature.com", "science.org",
  "nih.gov", "who.int", "cdc.gov", "nasa.gov", "arxiv.org", "nejm.org", "thelancet.com", "un.org", "europa.eu",
  "developer.mozilla.org", "nodejs.org", "python.org", "w3.org", "ietf.org", "github.com", "imf.org", "worldbank.org",
  "nytimes.com", "theguardian.com", "ft.com", "economist.com", "npr.org", "pbs.org", "bloomberg.com", "wsj.com",
];
const LOW = ["pinterest.", "quora.com", "answers.com", "medium.com", "blogspot.", "wordpress.com", "tiktok.com", "facebook.com", "x.com", "twitter.com"];

export type CredibilityLabel = "high" | "medium" | "low";

export function credibility(url: string): { score: number; label: CredibilityLabel; reason: string } {
  const host = hostname(url);
  if (!host) return { score: 0.2, label: "low", reason: "invalid URL" };
  if (/\.(gov|mil)(\.[a-z]{2})?$|\.edu$|\.ac\.[a-z]{2}$|\.int$/.test(host)) return { score: 0.9, label: "high", reason: "government, academic or international body" };
  if (HIGH.some((d) => host === d || host.endsWith(`.${d}`))) return { score: 0.85, label: "high", reason: "established reference or news organization" };
  if (LOW.some((d) => host.includes(d))) return { score: 0.35, label: "low", reason: "user-generated or social content" };
  return { score: 0.6, label: "medium", reason: "general website" };
}

const STOP = new Set(
  "the a an and or of to in on for with by from at as is are was were be been what which who whom when where why how does do did can could would should will about according current recent latest tell me please there their this that these those it its into than then".split(" "),
);

export function terms(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []).filter((w) => !STOP.has(w));
}

/**
 * How directly a result is about the question: the share of the title's words that are
 * question terms (a page titled "Japan" for a question about Japan scores 1), plus snippet overlap.
 */
export function topicality(question: string, title: string, snippet = ""): number {
  const q = new Set(terms(question));
  if (!q.size) return 0;
  const t = terms(title.replace(/\s[-|–—]\s[^-|–—]*$/, ""));
  const tp = t.length ? t.filter((w) => q.has(w)).length / t.length : 0;
  const s = new Set(terms(snippet));
  const sp = [...q].filter((w) => s.has(w)).length / q.size;
  return 0.6 * tp + 0.4 * sp;
}

/** Ranks results by topicality and credibility and, when freshness matters, by recency. */
export function rankResults<T extends { url: string; publishedAt?: string; title?: string; snippet?: string }>(items: T[], preferRecent: boolean, now = Date.now(), question = ""): T[] {
  const score = (it: T) => {
    let s = credibility(it.url).score * 0.5 + (question ? topicality(question, it.title ?? "", it.snippet ?? "") : 0);
    if (preferRecent && it.publishedAt) {
      const age = (now - Date.parse(it.publishedAt)) / 86_400_000;
      if (Number.isFinite(age)) s += age < 7 ? 0.25 : age < 60 ? 0.1 : age > 730 ? -0.15 : 0;
    }
    return s;
  };
  // Stable: ties keep the search engine's order (its own relevance ranking).
  return items.map((it, i) => ({ it, i, s: score(it) })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.it);
}
