import "server-only";
import { eq } from "drizzle-orm";
import { DEFAULT_SETTINGS, settingsSchema, type Settings } from "@/lib/shared/settings";
import { getDb, schema } from "./db/client";

export async function getSettings(userId: string): Promise<Settings> {
  const db = await getDb();
  const row = (await db.select().from(schema.settings).where(eq(schema.settings.userId, userId)).limit(1))[0];
  if (!row) return DEFAULT_SETTINGS;
  const data = { ...row.data };
  // Accounts created before the female default kept the old male voice unless the user chose it.
  if (data.voiceName === "Charon" && !data.voicePicked) data.voiceName = "Kore";
  const parsed = settingsSchema.safeParse(data);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export async function saveSettings(userId: string, patch: Partial<Settings>): Promise<Settings> {
  const merged = settingsSchema.parse({ ...(await getSettings(userId)), ...patch });
  const db = await getDb();
  await db
    .insert(schema.settings)
    .values({ userId, data: merged })
    .onConflictDoUpdate({ target: schema.settings.userId, set: { data: merged, updatedAt: new Date() } });
  return merged;
}
