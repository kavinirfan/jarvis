import "server-only";
import { isMac } from "./macos";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const LOOPBACK_IPS = /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/;

/**
 * Device tools act on the machine running the server, so they're only offered when:
 *  - the owner enabled them (JARVIS_DEVICE_TOOLS=true; the desktop app sets this), and
 *  - the server runs on macOS (other platforms aren't implemented yet), and
 *  - the request reached the server directly on localhost (not through a proxy or the network).
 * The user's "device access" setting is checked separately by the engine.
 */
export function deviceToolsAllowed(req: Request): boolean {
  if (process.env.JARVIS_DEVICE_TOOLS !== "true" || !isMac()) return false;
  const hostOf = (h: string | null) => (h ?? "").split(",")[0].trim().replace(/:\d+$/, "");
  if (!LOOPBACK.has(hostOf(req.headers.get("host")))) return false;
  // Next.js adds x-forwarded-* itself; when present they must also point at this machine.
  const fh = req.headers.get("x-forwarded-host");
  if (fh && !LOOPBACK.has(hostOf(fh))) return false;
  const ff = req.headers.get("x-forwarded-for");
  if (ff && !ff.split(",").every((ip) => LOOPBACK_IPS.test(ip.trim()))) return false;
  return true;
}
