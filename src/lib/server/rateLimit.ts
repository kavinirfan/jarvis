/**
 * Fixed-window, in-memory rate limiter. Good enough for a single server process; for several
 * instances, replace with a shared store (e.g. Redis) behind the same function.
 */
const windows = new Map<string, { start: number; count: number }>();

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): { ok: boolean; retryAfterMs: number } {
  const w = windows.get(key);
  if (!w || now - w.start >= windowMs) {
    windows.set(key, { start: now, count: 1 });
    if (windows.size > 10_000) {
      for (const [k, v] of windows) if (now - v.start >= windowMs) windows.delete(k);
    }
    return { ok: true, retryAfterMs: 0 };
  }
  w.count++;
  if (w.count > limit) return { ok: false, retryAfterMs: windowMs - (now - w.start) };
  return { ok: true, retryAfterMs: 0 };
}

/** Clears one key, e.g. after a successful login so only failed attempts count. */
export function clearRateLimit(key: string) {
  windows.delete(key);
}

export function resetRateLimitsForTests() {
  windows.clear();
}
