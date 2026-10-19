import "server-only";
import type { z } from "zod";
import { AppError } from "./errors";

export function errorResponse(status: number, code: string, message: string) {
  return Response.json({ code, message }, { status, headers: { "cache-control": "no-store" } });
}

/** Rejects cross-site requests so other websites can't act as the signed-in user or spend API quota. */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return; // Some browsers omit Origin on same-origin requests; SameSite cookies still apply.
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    throw new AppError(403, "forbidden", "Cross-site requests are not allowed.");
  }
  const expected = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host !== expected) throw new AppError(403, "forbidden", "Cross-site requests are not allowed.");
}

export async function readBody<T>(req: Request, schema: z.ZodType<T>, maxBytes = 256_000): Promise<T> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > maxBytes) throw new AppError(413, "too_large", "Request is too large.");
  let raw: unknown;
  try {
    const text = await req.text();
    if (text.length > maxBytes) throw new AppError(413, "too_large", "Request is too large.");
    raw = text ? JSON.parse(text) : {};
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(400, "bad_request", "Invalid JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new AppError(400, "bad_request", `Invalid request: ${first?.path.join(".") || "body"} ${first?.message ?? ""}`.trim());
  }
  return parsed.data;
}

/** Converts thrown errors into a JSON error response without leaking internals. */
export function handleError(e: unknown): Response {
  if (e instanceof AppError) return errorResponse(e.status, e.code, e.message);
  if ((e as Error)?.name === "AbortError") return errorResponse(499, "aborted", "Request cancelled.");
  console.error("[jarvis] unhandled error:", (e as Error)?.message ?? e);
  return errorResponse(500, "internal", "Something went wrong on the server.");
}

/** Wraps a route handler with error handling. */
export function route<A extends unknown[]>(fn: (req: Request, ...rest: A) => Promise<Response>) {
  return async (req: Request, ...rest: A): Promise<Response> => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") assertSameOrigin(req);
      return await fn(req, ...rest);
    } catch (e) {
      return handleError(e);
    }
  };
}

export function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, { ...init, headers: { "cache-control": "no-store", ...(init?.headers ?? {}) } });
}
