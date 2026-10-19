import { createDb, setDbForTests } from "@/lib/server/db/client";
import { resetConfigForTests } from "@/lib/server/config";
import { resetRateLimitsForTests } from "@/lib/server/rateLimit";
import { resetConfigMemoForTests } from "@/lib/server/reasoning/promptConfig";
import { clearSearchCacheForTests } from "@/lib/server/search";

export const ORIGIN = "http://localhost:3100";

export function freshDb() {
  resetConfigForTests();
  resetRateLimitsForTests();
  resetConfigMemoForTests();
  clearSearchCacheForTests();
  setDbForTests(createDb({ memory: true }));
}

type Handler = (req: Request, ctx?: never) => Promise<Response>;

export async function call(
  handler: unknown,
  opts: { method?: string; path?: string; body?: unknown; cookie?: string; origin?: string | null; params?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = { host: "localhost:3100" };
  if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
  if (opts.cookie) headers.cookie = opts.cookie;
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) body = opts.body;
  else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const req = new Request(`${ORIGIN}${opts.path ?? "/"}`, { method: opts.method ?? (body ? "POST" : "GET"), headers, body });
  const ctx = opts.params ? { params: Promise.resolve(opts.params) } : undefined;
  return (handler as Handler)(req, ctx as never);
}

export function cookieFrom(res: Response): string {
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

// Loosely-typed event for assertions in tests.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Ev = { type: string; [k: string]: any };

/** Reads an NDJSON assistant stream into events. */
export async function events(res: Response): Promise<Ev[]> {
  const text = await res.text();
  return text
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}
