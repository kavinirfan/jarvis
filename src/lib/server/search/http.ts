import { SearchError } from "./types";

export const USER_AGENT = `JARVIS/0.1 (self-hosted personal assistant${process.env.JARVIS_CONTACT ? `; ${process.env.JARVIS_CONTACT}` : ""})`;

export async function fetchJson<T>(provider: string, url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const timeout = AbortSignal.timeout(init.timeoutMs ?? 8000);
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { "user-agent": USER_AGENT, accept: "application/json", ...(init.headers ?? {}) },
      signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new SearchError(provider, (e as Error).name === "TimeoutError" ? "timed out" : "network error");
  }
  if (res.status === 401 || res.status === 403) throw new SearchError(provider, `rejected the API key (${res.status})`, false);
  if (res.status === 429) throw new SearchError(provider, "rate limit or quota reached");
  if (!res.ok) throw new SearchError(provider, `HTTP ${res.status}`);
  return (await res.json()) as T;
}
