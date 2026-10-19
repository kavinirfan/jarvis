import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { TtlCache } from "../cache";
import { USER_AGENT } from "../search/http";

/**
 * Fetches a web page and extracts readable text. Page content is untrusted: callers pass it
 * to the model as quoted evidence only, never as instructions.
 *
 * Safety: http(s) only, public IPs only (no localhost / private network: prevents SSRF),
 * every redirect re-checked, robots.txt respected, 6 s timeout, 1.5 MB cap.
 */

export interface ExtractedPage {
  url: string;
  title: string;
  text: string;
  publishedAt?: string;
  /** "ok", or why only the search snippet can be used. */
  status: "ok" | "paywalled" | "blocked_by_robots" | "unsupported" | "failed";
  detail?: string;
}

const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 6000;
const MAX_TEXT = 12_000;

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80") || v6.startsWith("ff");
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("invalid URL");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("only http(s) URLs are allowed");
  if (u.username || u.password) throw new Error("URLs with credentials are not allowed");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("private host");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new Error("private network address");
  return u;
}

const robotsCache = new TtlCache<string[]>(500, 60 * 60_000);

/** Minimal robots.txt check for the "*" and "JARVIS" user agents (Disallow prefixes). */
export function robotsDisallows(robots: string, path: string): boolean {
  let applies = false;
  const rules: string[] = [];
  const allows: string[] = [];
  for (const line of robots.split(/\r?\n/)) {
    const [k, ...rest] = line.replace(/#.*/, "").split(":");
    const key = k.trim().toLowerCase();
    const val = rest.join(":").trim();
    if (key === "user-agent") applies = val === "*" || /jarvis/i.test(val);
    else if (applies && key === "disallow" && val) rules.push(val);
    else if (applies && key === "allow" && val) allows.push(val);
  }
  const longest = (list: string[]) => Math.max(-1, ...list.filter((r) => path.startsWith(r.replace(/\*$/, ""))).map((r) => r.length));
  const d = longest(rules);
  return d >= 0 && d >= longest(allows);
}

async function allowedByRobots(u: URL): Promise<boolean> {
  const origin = u.origin;
  let rules = robotsCache.get(origin);
  if (!rules) {
    let body = "";
    try {
      const res = await fetch(`${origin}/robots.txt`, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(3000), redirect: "follow" });
      if (res.ok && (res.headers.get("content-type") ?? "").includes("text")) body = (await res.text()).slice(0, 100_000);
    } catch {
      // No robots.txt reachable: treat as allowed, as crawlers conventionally do.
    }
    rules = [body];
    robotsCache.set(origin, rules);
  }
  return !robotsDisallows(rules[0], u.pathname + u.search);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };
const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

/** Converts HTML to readable text, preferring <article>/<main> and dropping navigation chrome. */
export function htmlToText(html: string): { title: string; text: string; publishedAt?: string } {
  const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim();
  const publishedAt =
    html.match(/<meta[^>]+(?:property|name)=["'](?:article:published_time|date|pubdate|og:published_time)["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
    html.match(/<time[^>]+datetime=["']([^"']+)["']/i)?.[1];
  let body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|nav|footer|header|aside|form|iframe|template)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const main = body.match(/<(article|main)[^>]*>([\s\S]*?)<\/\1>/i)?.[2];
  if (main && main.length > 500) body = main;
  const text = decodeEntities(
    body
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 2)
    .join("\n");
  return { title, text: text.slice(0, MAX_TEXT), publishedAt };
}

const PAYWALL = /(subscribe to (continue|read)|subscription required|sign in to (continue|read)|already a subscriber|create a free account to continue)/i;

const pageCache = new TtlCache<ExtractedPage>(200, 30 * 60_000);

export async function extractPage(rawUrl: string, signal?: AbortSignal): Promise<ExtractedPage> {
  const cached = pageCache.get(rawUrl);
  if (cached) return cached;
  const result = await extractUncached(rawUrl, signal);
  if (result.status !== "failed") pageCache.set(rawUrl, result);
  return result;
}

async function extractUncached(rawUrl: string, signal?: AbortSignal): Promise<ExtractedPage> {
  const fail = (status: ExtractedPage["status"], detail: string): ExtractedPage => ({ url: rawUrl, title: "", text: "", status, detail });
  let url = rawUrl;
  try {
    for (let hop = 0; hop < 4; hop++) {
      const u = await assertPublicUrl(url);
      if (!(await allowedByRobots(u))) return fail("blocked_by_robots", "the site's robots.txt disallows automated reading");
      const timeout = AbortSignal.timeout(TIMEOUT_MS);
      const res = await fetch(u, {
        headers: { "user-agent": USER_AGENT, accept: "text/html,text/plain;q=0.9" },
        redirect: "manual",
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return fail("failed", `redirect without location (${res.status})`);
        url = new URL(loc, u).toString();
        continue;
      }
      if (res.status === 401 || res.status === 402 || res.status === 403) return fail("paywalled", `access denied (${res.status})`);
      if (!res.ok) return fail("failed", `HTTP ${res.status}`);
      const type = res.headers.get("content-type") ?? "";
      if (!/text\/html|text\/plain|application\/xhtml/.test(type)) return fail("unsupported", `unsupported content type ${type.split(";")[0]}`);
      const raw = await readCapped(res, MAX_BYTES);
      const page = type.includes("text/plain") ? { title: "", text: raw.slice(0, MAX_TEXT) } : htmlToText(raw);
      if (page.text.length < 400 && PAYWALL.test(raw)) return { url, ...page, status: "paywalled", detail: "page appears to be behind a paywall or login" };
      if (page.text.length < 200) return { url, ...page, status: "failed", detail: "too little readable text (the page may need JavaScript)" };
      return { url, ...page, status: "ok" };
    }
    return fail("failed", "too many redirects");
  } catch (e) {
    if ((e as Error).name === "AbortError" && signal?.aborted) throw e;
    return fail("failed", (e as Error).name === "TimeoutError" ? "timed out" : (e as Error).message);
  }
}

async function readCapped(res: Response, max: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    out += decoder.decode(value, { stream: true });
    if (total >= max) {
      void reader.cancel();
      break;
    }
  }
  return out;
}
