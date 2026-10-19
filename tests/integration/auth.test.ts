import { beforeAll, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as me } from "@/app/api/auth/me/route";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as assistant } from "@/app/api/assistant/route";
import { GET as memories } from "@/app/api/memories/route";
import { GET as settingsGet, PUT as settingsPut } from "@/app/api/settings/route";
import { hashPassword, verifyPassword } from "@/lib/server/auth";
import { getDb, schema } from "@/lib/server/db/client";
import { call, cookieFrom, freshDb } from "./helpers";

beforeAll(() => freshDb());

describe("authentication and authorization", () => {
  let cookie = "";

  it("hashes passwords with scrypt", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h).toMatch(/^scrypt\$/);
    expect(await verifyPassword("correct horse battery", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
  });

  it("lets the first user register as owner and rejects weak passwords", async () => {
    expect((await call(register, { body: { email: "owner@example.com", password: "short" } })).status).toBe(400);
    const res = await call(register, { body: { email: "Owner@Example.com", password: "correct horse battery" } });
    expect(res.status).toBe(200);
    cookie = cookieFrom(res);
    expect(res.headers.get("set-cookie")).toMatch(/HttpOnly/);
    expect(res.headers.get("set-cookie")).toMatch(/SameSite=Lax/);
    const who = await (await call(me, { cookie })).json();
    expect(who.user.email).toBe("owner@example.com");
    expect(who.user.admin).toBe(true);
  });

  it("closes sign-up after the owner exists (unless enabled)", async () => {
    expect((await call(register, { body: { email: "stranger@example.com", password: "another long password" } })).status).toBe(403);
  });

  it("stores only a hash of the session token", async () => {
    const db = await getDb();
    const rows = await db.select().from(schema.sessions);
    const token = cookie.split("=")[1];
    expect(rows.some((r) => r.id === token)).toBe(false);
    expect(rows[0].id).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects wrong passwords and accepts the right one", async () => {
    expect((await call(login, { body: { email: "owner@example.com", password: "nope nope nope" } })).status).toBe(401);
    expect((await call(login, { body: { email: "nobody@example.com", password: "nope nope nope" } })).status).toBe(401);
    expect((await call(login, { body: { email: "owner@example.com", password: "correct horse battery" } })).status).toBe(200);
  });

  it("locks out repeated failed logins but not successful ones", async () => {
    for (let i = 0; i < 10; i++) expect((await call(login, { body: { email: "owner@example.com", password: "correct horse battery" } })).status).toBe(200);
    for (let i = 0; i < 8; i++) await call(login, { body: { email: "owner@example.com", password: "wrong password!!" } });
    expect((await call(login, { body: { email: "owner@example.com", password: "correct horse battery" } })).status).toBe(429);
  });

  it("requires a session for private APIs", async () => {
    expect((await call(memories)).status).toBe(401);
    expect((await call(assistant, { body: { text: "hi", trigger: "typed" } })).status).toBe(401);
    expect((await call(settingsGet)).status).toBe(401);
  });

  it("rejects cross-site requests", async () => {
    const res = await call(settingsPut, { method: "PUT", cookie, origin: "https://evil.example", body: { memoryEnabled: false } });
    expect(res.status).toBe(403);
  });

  it("validates and persists settings", async () => {
    expect((await call(settingsPut, { method: "PUT", cookie, body: { speechRate: 9 } })).status).toBe(400);
    const res = await call(settingsPut, { method: "PUT", cookie, body: { responseLength: "brief", listenMode: "ambient" } });
    expect((await res.json()).settings.responseLength).toBe("brief");
    const got = await (await call(settingsGet, { cookie })).json();
    expect(got.settings).toMatchObject({ responseLength: "brief", listenMode: "ambient", memoryEnabled: true });
  });

  it("logs out by deleting the session", async () => {
    await call(logout, { method: "POST", cookie });
    expect((await call(memories, { cookie })).status).toBe(401);
  });
});
