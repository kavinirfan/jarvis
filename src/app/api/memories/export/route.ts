import { requireUser } from "@/lib/server/auth";
import { route } from "@/lib/server/http";
import { listMemories } from "@/lib/server/memory";

export const GET = route(async (req) => {
  const user = await requireUser(req);
  const memories = await listMemories(user.id);
  return new Response(JSON.stringify({ exportedAt: new Date().toISOString(), memories }, null, 2), {
    headers: { "content-type": "application/json", "content-disposition": 'attachment; filename="jarvis-memories.json"', "cache-control": "no-store" },
  });
});
