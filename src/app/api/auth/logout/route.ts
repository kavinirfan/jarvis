import { clearedSessionCookie, destroySession, getSessionUser } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";

export const POST = route(async (req) => {
  const user = await getSessionUser(req);
  if (user) await destroySession(user.sessionId);
  return json({ ok: true }, { headers: { "set-cookie": clearedSessionCookie() } });
});
