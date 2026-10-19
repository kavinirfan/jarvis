/** Small TTL + LRU cache for search results and fetched pages, to save API calls. */
export class TtlCache<V> {
  private map = new Map<string, { value: V; expires: number }>();

  constructor(
    private max = 500,
    private ttlMs = 15 * 60_000,
  ) {}

  get(key: string, now = Date.now()): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires <= now) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, hit); // refresh LRU position
    return hit.value;
  }

  set(key: string, value: V, ttlMs = this.ttlMs, now = Date.now()) {
    this.map.delete(key);
    this.map.set(key, { value, expires: now + ttlMs });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }

  clear() {
    this.map.clear();
  }
}
