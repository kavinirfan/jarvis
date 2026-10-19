import "server-only";
import { getDb, schema } from "./db/client";

export async function audit(
  userId: string | null,
  action: string,
  status: "ok" | "denied" | "failed" | "pending" | "cancelled",
  detail: Record<string, unknown> = {},
  risk: "low" | "medium" | "high" = "low",
) {
  try {
    const db = await getDb();
    await db.insert(schema.auditLog).values({ userId, action, status, detail, risk });
  } catch (e) {
    console.warn("[jarvis] audit write failed:", (e as Error).message);
  }
}
