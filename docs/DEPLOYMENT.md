# Deployment guide

> Status: JARVIS has **not** been deployed to a public host yet. This guide describes how to do it.
> Everything below `npm run build && npm start` was tested locally; hosting-specific steps are unverified.

JARVIS needs a **Node.js server** (API routes and streaming), **PostgreSQL**, and **HTTPS** (the
microphone and PWA install require it). Keys stay on the server.

## Option A: Node.js host (Render, Railway, Fly.io, or a VPS)

Recommended, because long-running streaming responses and a persistent process suit JARVIS best.

1. Create a PostgreSQL database (Neon, Supabase, Render Postgres, RDS, …) and copy its connection string.
2. Set these environment variables on the host:
   ```
   GEMINI_API_KEY=...
   DATABASE_URL=postgres://...      # required in production (PGlite is single-process, local only)
   TAVILY_API_KEY=...               # recommended
   JARVIS_DAILY_REQUEST_BUDGET=400  # per user per day
   NODE_ENV=production
   ```
3. Build command: `npm ci && npm run build`. Start command: `npm start` (honours `PORT`).
4. Migrations run automatically on the first request (from `./drizzle`).
5. Open the HTTPS URL and create the owner account **immediately**, because the first account
   becomes the owner. Sign-up then closes automatically.

On a plain VPS, put Caddy or nginx in front for HTTPS, e.g. Caddy: `jarvis.example.com { reverse_proxy localhost:3000 }`,
and keep the process alive with systemd or pm2.

## Option B: Vercel

Works with caveats:
- Set the same environment variables, with `DATABASE_URL` pointing at a pooled Postgres (Neon recommended).
- Assistant and evaluation routes set `maxDuration` (60 s / 300 s). Free plans cap function time
  lower, so long research answers may be cut off.
- Rate limits and caches are per function instance (in memory), so they're weaker across instances.
- `outputFileTracingIncludes` in `next.config.ts` ships the `drizzle/` migrations with the functions.

## Costs and free-plan reality

- Free hosting plans sleep when idle and limit request duration. Expect a cold start, and
  occasional cut-off research answers.
- The browser does the continuous listening work (wake word, audio capture), so the server only
  handles requests. A small instance (512 MB) is enough for one person.
- Gemini's free tier has low per-minute and per-day limits; natural voice (TTS) runs out especially
  fast. Enable billing on the Google AI Studio project for daily use, and set
  `JARVIS_DAILY_REQUEST_BUDGET` to cap spend.
- Scheduled or background jobs aren't included. If you add them (for example a nightly evaluation),
  use the host's cron feature to call `POST /api/eval`, and remember each run makes about 20 AI calls.

## Checklist before going public

- [ ] `npm run test:all` passes
- [ ] HTTPS works; `curl -I https://your-host/` shows the `Content-Security-Policy` header
- [ ] Owner account created; `JARVIS_ALLOW_REGISTRATION` unset (or `true` only if you want others to sign up)
- [ ] `DATABASE_URL` set, with backups enabled at the database provider
- [ ] Gemini billing or quota sized for your use; daily budget set
- [ ] Rotate any key that was ever shared or printed
