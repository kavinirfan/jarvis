import { count } from "drizzle-orm";
import { z } from "zod";
import { createSession, hashPassword, sessionCookie, validatePassword } from "@/lib/server/auth";
import { audit } from "@/lib/server/audit";
import { config } from "@/lib/server/config";
import { getDb, schema } from "@/lib/server/db/client";
import { AppError } from "@/lib/server/errors";
import { json, readBody, route } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rateLimit";

const body = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().max(200),
  displayName: z.string().trim().max(80).default(""),
});

export const POST = route(async (req) => {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!rateLimit(`register:${ip}`, 5, 60 * 60_000).ok) throw new AppError(429, "rate_limited", "Too many sign-up attempts. Try again later.");
  const { email, password, displayName } = await readBody(req, body);
  const problem = validatePassword(password);
  if (problem) throw new AppError(400, "weak_password", problem);

  const db = await getDb();
  const [{ n }] = await db.select({ n: count() }).from(schema.users);
  if (Number(n) > 0 && !config().allowRegistration) {
    throw new AppError(403, "registration_closed", "Sign-up is closed on this JARVIS server. Ask the owner to set JARVIS_ALLOW_REGISTRATION=true.");
  }
  const [user] = await db
    .insert(schema.users)
    .values({ email, passwordHash: await hashPassword(password), displayName })
    .onConflictDoNothing()
    .returning({ id: schema.users.id });
  if (!user) throw new AppError(409, "exists", "An account with that email already exists. Sign in instead.");
  const token = await createSession(user.id, req.headers.get("user-agent") ?? "");
  await audit(user.id, "auth:register", "ok");
  return json({ ok: true }, { headers: { "set-cookie": sessionCookie(token) } });
});
