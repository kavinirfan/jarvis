import { eq } from "drizzle-orm";
import { z } from "zod";
import { createSession, hashPassword, sessionCookie, verifyPassword } from "@/lib/server/auth";
import { audit } from "@/lib/server/audit";
import { getDb, schema } from "@/lib/server/db/client";
import { AppError } from "@/lib/server/errors";
import { json, readBody, route } from "@/lib/server/http";
import { clearRateLimit, rateLimit } from "@/lib/server/rateLimit";

const body = z.object({ email: z.string().trim().toLowerCase().max(200), password: z.string().max(200) });
let dummyHash: Promise<string> | null = null;

export const POST = route(async (req) => {
  const { email, password } = await readBody(req, body);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const limitKey = `login:${ip}:${email}`;
  if (!rateLimit(limitKey, 8, 15 * 60_000).ok) throw new AppError(429, "rate_limited", "Too many sign-in attempts. Wait 15 minutes and try again.");

  const db = await getDb();
  const user = (await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1))[0];
  // Verify against a dummy hash for unknown emails so timing doesn't reveal which accounts exist.
  dummyHash ??= hashPassword("not-a-real-password");
  const ok = await verifyPassword(password, user?.passwordHash ?? (await dummyHash));
  if (!user || !ok) {
    await audit(user?.id ?? null, "auth:login", "denied");
    throw new AppError(401, "bad_credentials", "Wrong email or password.");
  }
  clearRateLimit(limitKey); // only failed attempts count toward the limit
  const token = await createSession(user.id, req.headers.get("user-agent") ?? "");
  await audit(user.id, "auth:login", "ok");
  return json({ ok: true }, { headers: { "set-cookie": sessionCookie(token) } });
});
