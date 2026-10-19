"use client";

import type { AssistantEvent } from "@/lib/shared/events";

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}

async function errorFrom(res: Response): Promise<ApiError> {
  const data = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
  return new ApiError(data?.code ?? "http_error", data?.message ?? `Request failed (${res.status}).`, res.status);
}

export async function api<T>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      headers: json !== undefined ? { "content-type": "application/json", ...(rest.headers ?? {}) } : rest.headers,
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError("network", "Can't reach the JARVIS server. Check your connection.");
  }
  if (!res.ok) throw await errorFrom(res);
  return (await res.json()) as T;
}

/** Streams NDJSON events from the assistant endpoint. */
export async function streamAssistant(body: unknown, onEvent: (e: AssistantEvent) => void, signal: AbortSignal): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError("network", "Can't reach the JARVIS server. Check your connection and try again.");
  }
  if (!res.ok || !res.body) throw await errorFrom(res);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) onEvent(JSON.parse(line) as AssistantEvent);
    }
  }
  if (buf.trim()) onEvent(JSON.parse(buf) as AssistantEvent);
}
