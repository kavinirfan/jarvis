const TRACKING = /^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|ref$|ref_src$|igshid$|si$)/i;

/** Canonical form of a URL for duplicate detection (no tracking params, fragment, www or trailing slash). */
export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^www\.|^m\./, "");
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    u.searchParams.sort();
    let s = `${u.protocol}//${u.hostname}${u.port ? `:${u.port}` : ""}${u.pathname.replace(/\/+$/, "")}`;
    const q = u.searchParams.toString();
    if (q) s += `?${q}`;
    return s;
  } catch {
    return raw.trim();
  }
}

export function hostname(raw: string): string {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

const normTitle = (t: string) =>
  t
    .toLowerCase()
    .replace(/\s[-|–—]\s.*$/, "") // drop " - Site Name" suffixes
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Removes results that point at the same page, or repeat the same headline. */
export function dedupe<T extends { url: string; title: string }>(items: T[]): T[] {
  const seenUrl = new Set<string>();
  const seenTitle = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const u = canonicalUrl(it.url);
    const t = normTitle(it.title);
    if (seenUrl.has(u) || (t.length > 15 && seenTitle.has(t))) continue;
    seenUrl.add(u);
    if (t.length > 15) seenTitle.add(t);
    out.push(it);
  }
  return out;
}
