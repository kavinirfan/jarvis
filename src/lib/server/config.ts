import "server-only";

/**
 * All server configuration comes from environment variables (.env.local in development).
 * Nothing here is ever sent to the browser; /api/status only reports which services are
 * configured, never the values.
 */

function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

function num(name: string, fallback: number): number {
  const v = Number(env(name));
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export interface ServerConfig {
  geminiKey?: string;
  tavilyKey?: string;
  braveKey?: string;
  databaseUrl?: string;
  /** Embedded Postgres (PGlite) directory, used when DATABASE_URL is not set. */
  pgliteDir: string;
  /** "mock" forces mock AI/search providers; "auto" uses real ones when keys exist. */
  providerMode: "auto" | "mock";
  searchProvider: "auto" | "tavily" | "brave" | "gemini" | "wikipedia" | "mock";
  models: { fast: string; balanced: string; transcribe: string; transcribeLive: string; tts: string };
  /** Daily request budget per user for paid-ish calls (LLM + search + TTS). */
  dailyBudget: number;
  /** Open sign-up. When false (default) only the first account can register. */
  allowRegistration: boolean;
  /** Emails allowed to manage global settings (prompt configs). The first account is always admin. */
  adminEmails: string[];
  isProduction: boolean;
}

let cached: ServerConfig | null = null;

export function config(): ServerConfig {
  if (cached) return cached;
  const mode = env("JARVIS_PROVIDER_MODE") === "mock" ? "mock" : "auto";
  const search = (env("SEARCH_PROVIDER") ?? "auto").toLowerCase();
  cached = {
    geminiKey: env("GEMINI_API_KEY"),
    tavilyKey: env("TAVILY_API_KEY"),
    braveKey: env("BRAVE_SEARCH_API_KEY"),
    databaseUrl: env("DATABASE_URL"),
    pgliteDir: env("PGLITE_DIR") ?? ".data/pglite",
    providerMode: mode,
    searchProvider: (["auto", "tavily", "brave", "gemini", "wikipedia", "mock"].includes(search) ? search : "auto") as ServerConfig["searchProvider"],
    models: {
      fast: env("GEMINI_FAST_MODEL") ?? "gemini-3.5-flash-lite",
      balanced: env("GEMINI_MODEL") ?? "gemini-3.8-flash",
      transcribe: env("GEMINI_TRANSCRIBE_MODEL") ?? "gemini-3.5-transcribe",
      transcribeLive: env("GEMINI_TRANSCRIBE_LIVE_MODEL") ?? "gemini-3.5-transcribe-live",
      tts: env("GEMINI_TTS_MODEL") ?? "gemini-3.8-flash-lite-tts",
    },
    dailyBudget: num("JARVIS_DAILY_REQUEST_BUDGET", 400),
    allowRegistration: env("JARVIS_ALLOW_REGISTRATION") === "true",
    adminEmails: (env("JARVIS_ADMIN_EMAILS") ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean),
    isProduction: process.env.NODE_ENV === "production",
  };
  return cached;
}

/** For tests: forget cached config after changing process.env. */
export function resetConfigForTests() {
  cached = null;
}

export interface ConfigIssue {
  service: string;
  level: "error" | "warning" | "info";
  message: string;
}

/** Human-readable configuration problems, shown on the dashboard and logged at startup. */
export function configIssues(c = config()): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  if (c.providerMode === "mock") {
    issues.push({ service: "ai", level: "warning", message: "Mock mode is on (JARVIS_PROVIDER_MODE=mock). Answers are canned test output, not real AI." });
  } else if (!c.geminiKey) {
    issues.push({
      service: "ai",
      level: "error",
      message: "GEMINI_API_KEY is not set. JARVIS will use clearly-labelled mock answers. Add the key to .env.local and restart.",
    });
  }
  if (!c.tavilyKey && !c.braveKey && c.searchProvider === "auto") {
    issues.push({
      service: "search",
      level: "warning",
      message: "No web-search key (TAVILY_API_KEY or BRAVE_SEARCH_API_KEY). Research uses Wikipedia only, so very recent news may be missed.",
    });
  }
  if (!c.databaseUrl) {
    issues.push({
      service: "database",
      level: "info",
      message: `Using embedded Postgres in ${c.pgliteDir}. Set DATABASE_URL for a shared database (needed for multi-instance hosting).`,
    });
  }
  return issues;
}
