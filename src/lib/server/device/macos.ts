import "server-only";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat, writeFile, appendFile } from "node:fs/promises";
import { homedir, hostname, tmpdir, userInfo } from "node:os";
import { isAbsolute, join, normalize, resolve } from "node:path";
import { promisify } from "node:util";
import { AppError } from "../errors";

/**
 * Low-level access to this Mac. Every helper runs a fixed program with an argument array
 * (execFile, no shell), so model-provided text is never interpreted as a command.
 */
const exec = promisify(execFile);

export const isMac = () => process.platform === "darwin";

async function sh(cmd: string, args: string[], timeout = 8000): Promise<string> {
  try {
    const { stdout } = await exec(cmd, args, { timeout, maxBuffer: 4 * 1024 * 1024 });
    return stdout.trim();
  } catch (e) {
    const err = e as { stderr?: string; message: string; killed?: boolean };
    if (err.killed) throw new AppError(504, "device_timeout", `${cmd} took too long.`);
    throw new AppError(500, "device_error", (err.stderr || err.message).trim().slice(0, 300));
  }
}

export function osa(script: string, timeout = 10_000) {
  return sh("osascript", ["-e", script], timeout);
}

/** AppleScript string literal. */
export const asStr = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

// ------------------------------------------------------------------ paths

export const HOME = homedir();

export function resolveUserPath(p: string): string {
  const expanded = p.startsWith("~") ? join(HOME, p.slice(1)) : p;
  const abs = normalize(isAbsolute(expanded) ? expanded : resolve(HOME, expanded));
  if (abs !== HOME && !abs.startsWith(HOME + "/")) throw new AppError(403, "outside_home", "JARVIS can only access files inside your home folder.");
  return abs;
}

const SENSITIVE = [
  /\/\.ssh(\/|$)/, /\/\.gnupg(\/|$)/, /\/\.aws(\/|$)/, /\/\.kube(\/|$)/, /\/\.docker\/config/, /\/Library\/Keychains(\/|$)/,
  /\/Library\/Cookies/, /\/Library\/Application Support\/(Google\/Chrome|Firefox|BraveSoftware|Microsoft Edge)/, /\/Library\/Safari/,
  /\/Library\/Messages/, /\/Library\/Mail/, /(^|\/)\.env(\.|$)/, /\.(pem|key|p12|pfx|kdbx)$/i, /(^|\/)id_(rsa|ed25519|ecdsa)/, /password|secret|credential/i,
];
export const isSensitivePath = (p: string) => SENSITIVE.some((re) => re.test(p));

// ------------------------------------------------------------------ status

export async function systemStatus() {
  const [batt, disk, sw, up, front, vol, wifi, mem] = await Promise.all([
    sh("pmset", ["-g", "batt"]).catch(() => ""),
    sh("df", ["-h", "/"]).catch(() => ""),
    sh("sw_vers", []).catch(() => ""),
    sh("uptime", []).catch(() => ""),
    osa('tell application "System Events" to get name of first application process whose frontmost is true').catch(() => ""),
    osa("output volume of (get volume settings)").catch(() => ""),
    sh("networksetup", ["-getairportnetwork", "en0"]).catch(() => ""),
    sh("sysctl", ["-n", "hw.memsize"]).catch(() => ""),
  ]);
  const pct = batt.match(/(\d+)%/)?.[1];
  const charging = /AC Power/.test(batt) ? "plugged in" : "on battery";
  const diskLine = disk.split("\n")[1]?.split(/\s+/) ?? [];
  return {
    computer: hostname(),
    user: userInfo().username,
    macOS: sw.match(/ProductVersion:\s*(.+)/)?.[1],
    battery: pct ? `${pct}% (${charging}${/; (.+?) remaining/.test(batt) ? `, ${batt.match(/; (.+?) remaining/)?.[1]} remaining` : ""})` : "no battery / unknown",
    disk: diskLine.length > 4 ? `${diskLine[3]} free of ${diskLine[1]} (${diskLine[4]} used)` : undefined,
    memoryGB: mem ? Math.round(Number(mem) / 1e9) : undefined,
    uptime: up.replace(/^.*up\s+/, "up ").split(",").slice(0, 2).join(",").trim(),
    frontmostApp: front || undefined,
    volume: vol ? `${vol}%` : undefined,
    wifi: wifi.replace(/^Current Wi-Fi Network:\s*/, "") || undefined,
  };
}

export async function runningApps(): Promise<string[]> {
  const out = await osa('tell application "System Events" to get name of (every application process whose background only is false)');
  return out.split(", ").filter(Boolean);
}

// ------------------------------------------------------------------ apps & urls

const APP_NAME = /^[\p{L}\p{N} .&'+()-]{1,80}$/u;

export async function openApp(name: string) {
  if (!APP_NAME.test(name)) throw new AppError(400, "bad_name", "That doesn't look like an app name.");
  await sh("open", ["-a", name]);
}

export async function quitApp(name: string) {
  if (!APP_NAME.test(name)) throw new AppError(400, "bad_name", "That doesn't look like an app name.");
  await osa(`tell application ${asStr(name)} to quit`);
}

export async function openTarget(target: string) {
  await sh("open", [target]);
}

export async function revealInFinder(path: string) {
  await sh("open", ["-R", path]);
}

// ------------------------------------------------------------------ files

export async function findFiles(query: string, limit = 25): Promise<string[]> {
  const out = await sh("mdfind", ["-onlyin", HOME, query], 15_000);
  return out
    .split("\n")
    .filter((p) => p && !/\/Library\/|\/\.|node_modules/.test(p.slice(HOME.length)))
    .slice(0, limit);
}

export async function listDirectory(path: string) {
  const entries = await readdir(path, { withFileTypes: true });
  return entries
    .filter((e) => !e.name.startsWith("."))
    .slice(0, 200)
    .map((e) => `${e.isDirectory() ? "📁 " : ""}${e.name}`);
}

export async function readTextFile(path: string, maxChars = 20_000): Promise<{ text: string; truncated: boolean; bytes: number }> {
  const st = await stat(path);
  if (st.isDirectory()) throw new AppError(400, "is_directory", "That's a folder; list it instead.");
  if (st.size > 5_000_000) throw new AppError(413, "too_large", "That file is too large to read (over 5 MB).");
  if (/\.pdf$/i.test(path)) {
    const txt = await sh("mdls", ["-raw", "-name", "kMDItemTextContent", path]).catch(() => "");
    return { text: txt.slice(0, maxChars), truncated: txt.length > maxChars, bytes: st.size };
  }
  const buf = await readFile(path);
  if (buf.subarray(0, 8000).includes(0)) throw new AppError(415, "binary", "That's a binary file, not text.");
  const text = buf.toString("utf8");
  return { text: text.slice(0, maxChars), truncated: text.length > maxChars, bytes: st.size };
}

export async function writeTextFile(path: string, content: string, mode: "create" | "overwrite" | "append") {
  if (mode === "create") {
    const exists = await stat(path).then(() => true).catch(() => false);
    if (exists) throw new AppError(409, "exists", "That file already exists. Ask to overwrite or append instead.");
  }
  if (mode === "append") await appendFile(path, content);
  else await writeFile(path, content);
}

/** Moves to the Trash (recoverable), never deletes permanently. */
export async function moveToTrash(path: string) {
  await osa(`tell application "Finder" to delete (POSIX file ${asStr(path)} as alias)`, 15_000);
}

// ------------------------------------------------------------------ media, sound, clipboard

export async function setVolume(level: number) {
  await osa(`set volume output volume ${Math.max(0, Math.min(100, Math.round(level)))}`);
}

export async function setMuted(muted: boolean) {
  await osa(`set volume output muted ${muted}`);
}

export async function mediaControl(action: "playpause" | "next" | "previous" | "pause" | "play") {
  const apps = await runningApps().catch(() => [] as string[]);
  const player = ["Spotify", "Music"].find((a) => apps.includes(a));
  if (!player) throw new AppError(404, "no_player", "Neither Spotify nor Music is open.");
  const verb = { playpause: "playpause", next: "next track", previous: "previous track", pause: "pause", play: "play" }[action];
  await osa(`tell application ${asStr(player)} to ${verb}`);
  const now = await osa(`tell application ${asStr(player)} to if player state is playing then return (name of current track) & " — " & (artist of current track)`).catch(() => "");
  return { player, nowPlaying: now || null };
}

export const getClipboard = () => sh("pbpaste", []);

export async function setClipboard(text: string) {
  await new Promise<void>((res, rej) => {
    const p = execFile("pbcopy", [], (err) => (err ? rej(err) : res()));
    p.stdin?.end(text);
  });
}

// ------------------------------------------------------------------ screen, notifications, apps

/** Captures the screen as a JPEG (needs Screen Recording permission for the JARVIS process). */
export async function screenshot(): Promise<{ data: string; mimeType: string }> {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-shot-"));
  try {
    const file = join(dir, "screen.jpg");
    await sh("screencapture", ["-x", "-t", "jpg", "-C", file], 15_000);
    await sh("sips", ["-Z", "1800", file]).catch(() => "");
    const buf = await readFile(file);
    if (buf.length < 5000) throw new AppError(403, "screen_permission", "The screenshot came back empty. Allow Screen Recording for JARVIS (or your terminal) in System Settings → Privacy & Security.");
    return { data: buf.toString("base64"), mimeType: "image/jpeg" };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function notify(title: string, text: string) {
  await osa(`display notification ${asStr(text.slice(0, 200))} with title ${asStr(title.slice(0, 60))}`);
}

export async function createReminder(title: string, notes?: string) {
  await osa(`tell application "Reminders" to make new reminder with properties {name:${asStr(title)}${notes ? `, body:${asStr(notes)}` : ""}}`, 15_000);
}

export async function createAppleNote(title: string, body: string) {
  const html = `<h1>${title.replace(/[<>&]/g, "")}</h1><div>${body.replace(/[<>&]/g, "").replace(/\n/g, "<br>")}</div>`;
  await osa(`tell application "Notes" to make new note with properties {body:${asStr(html)}}`, 15_000);
}

export async function upcomingEvents(days: number): Promise<string> {
  const script = `
set out to ""
set startD to current date
set endD to startD + (${Math.max(1, Math.min(14, days))} * days)
tell application "Calendar"
  repeat with c in calendars
    set evs to (every event of c whose start date ≥ startD and start date ≤ endD)
    repeat with e in evs
      set out to out & (start date of e as string) & " | " & (summary of e) & linefeed
    end repeat
  end repeat
end tell
return out`;
  return osa(script, 25_000);
}

export async function sendIMessage(to: string, text: string) {
  await osa(`tell application "Messages" to send ${asStr(text)} to buddy ${asStr(to)} of (first service whose service type = iMessage)`, 15_000);
}

export async function lockScreen() {
  await sh("pmset", ["displaysleepnow"]);
}

export function deviceIdentity() {
  return { computer: hostname(), user: userInfo().username, home: HOME, platform: process.platform };
}
