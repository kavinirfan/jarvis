import "server-only";
import { and, count, eq, gte, sql } from "drizzle-orm";
import { config } from "./config";
import { getDb, schema } from "./db/client";
import { AppError } from "./errors";

export type UsageKind = "llm" | "search" | "tts" | "stt" | "search_failure" | "error";
const BILLABLE: UsageKind[] = ["llm", "search", "tts", "stt"];

/** Records usage or failures. Never throws: telemetry must not break a request. */
export async function recordUsage(
  userId: string | null,
  kind: UsageKind,
  provider: string,
  extra: { units?: number; latencyMs?: number; detail?: Record<string, unknown> } = {},
) {
  try {
    const db = await getDb();
    await db.insert(schema.usageEvents).values({
      userId,
      kind,
      provider,
      units: extra.units ?? 1,
      latencyMs: extra.latencyMs ?? null,
      detail: extra.detail ?? {},
    });
  } catch (e) {
    console.warn("[jarvis] usage record failed:", (e as Error).message);
  }
}

function startOfDay() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function usageToday(userId: string) {
  const db = await getDb();
  const rows = await db
    .select({ kind: schema.usageEvents.kind, n: count() })
    .from(schema.usageEvents)
    .where(and(eq(schema.usageEvents.userId, userId), gte(schema.usageEvents.createdAt, startOfDay())))
    .groupBy(schema.usageEvents.kind);
  const byKind: Record<string, number> = {};
  for (const r of rows) byKind[r.kind] = Number(r.n);
  const billable = BILLABLE.reduce((n, k) => n + (byKind[k] ?? 0), 0);
  return { byKind, billable, budget: config().dailyBudget };
}

/** Throws 429 once the user's daily request budget is used up. */
export async function assertBudget(userId: string) {
  const { billable, budget } = await usageToday(userId);
  if (billable >= budget) {
    throw new AppError(429, "budget_exceeded", `Daily usage budget reached (${budget} requests). Raise JARVIS_DAILY_REQUEST_BUDGET or try tomorrow.`);
  }
}

export async function recentFailures(userId: string, limit = 20) {
  const db = await getDb();
  return db
    .select()
    .from(schema.usageEvents)
    .where(and(eq(schema.usageEvents.userId, userId), sql`${schema.usageEvents.kind} in ('search_failure','error')`))
    .orderBy(sql`${schema.usageEvents.createdAt} desc`)
    .limit(limit);
}
