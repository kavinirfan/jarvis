import "server-only";
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt, lt } from "drizzle-orm";
import { config } from "./config";
import { getDb, schema } from "./db/client";
import { AppError } from "./errors";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number }) => Promise<Buffer>;

export const SESSION_COOKIE = "jarvis_session";
const SESSION_DAYS = 30;
const SCRYPT = { N: 16384, r: 8, p: 1 };

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  sessionId: string;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, saltB64, keyB64] = stored.split("$");
  if (algo !== "scrypt" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const key = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, { ...SCRYPT, N: Number(n) });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export function validatePassword(password: string): string | null {
  if (password.length < 10) return "Use at least 10 characters for your password.";
  if (password.length > 200) return "That password is too long.";
  return null;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Creates a session and returns the raw token for the cookie. Only its hash is stored. */
export async function createSession(userId: string, userAgent: string): Promise<string> {
  const db = await getDb();
  const token = randomBytes(32).toString("base64url");
  await db.insert(schema.sessions).values({
    id: sha256(token),
    userId,
    userAgent: userAgent.slice(0, 300),
    expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000),
  });
  // Opportunistic cleanup of expired sessions.
  await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, new Date()));
  return token;
}

export function sessionCookie(token: string, maxAgeSeconds = SESSION_DAYS * 86_400): string {
  const parts = [`${SESSION_COOKIE}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSeconds}`];
  if (config().isProduction) parts.push("Secure");
  return parts.join("; ");
}

export function clearedSessionCookie(): string {
  return sessionCookie("", 0);
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

export async function getSessionUser(req: Request): Promise<SessionUser | null> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token || token.length > 100) return null;
  const db = await getDb();
  const id = sha256(token);
  const rows = await db
    .select({ id: schema.users.id, email: schema.users.email, displayName: schema.users.displayName, lastSeenAt: schema.sessions.lastSeenAt })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.id, id), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (Date.now() - row.lastSeenAt.getTime() > 3_600_000) {
    await db.update(schema.sessions).set({ lastSeenAt: new Date() }).where(eq(schema.sessions.id, id));
  }
  return { id: row.id, email: row.email, displayName: row.displayName, sessionId: id };
}

/** Throws 401 unless the request carries a valid session. */
export async function requireUser(req: Request): Promise<SessionUser> {
  const user = await getSessionUser(req);
  if (!user) throw new AppError(401, "unauthenticated", "Please sign in.");
  return user;
}

export async function destroySession(sessionId: string) {
  const db = await getDb();
  await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
}
