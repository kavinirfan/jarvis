# Architecture

JARVIS is a Next.js 16 + TypeScript application: a responsive, installable web app (PWA) and a
server API in one project. Every client (browser, installed PWA, future native companions) uses
the same backend, account, history and approved memories.

```
┌──────────────────────────── Browser / PWA ─────────────────────────────┐
│ Microphone ─▶ AudioWorklet (16 kHz PCM, 100 ms) ─┬─▶ Energy VAD + 1.5 s pre-roll
│                                                  ├─▶ openWakeWord (ONNX, on-device) ── "Hey JARVIS"
│                                                  │      └─▶ command recorder ─▶ /api/stt/transcribe
│                                                  └─▶ (ambient) Gemini Live STT over WebSocket
│                                                         (single-use token from /api/stt/token)
│ Tab/system audio (getDisplayMedia) ─▶ separate Gemini Live stream, labelled "system"
│ Transcript (timestamped) ─▶ question detector ─▶ POST /api/assistant (NDJSON stream)
│ Answer ─▶ sentence-chunked TTS (/api/tts, fallback: speechSynthesis) — interruptible
└─────────────────────────────────────────────────────────────────────────┘
┌──────────────────────────── Server (Node) ─────────────────────────────┐
│ auth (scrypt, hashed session tokens) · same-origin checks · rate limits · daily budget
│ Reasoning workflow (src/lib/server/reasoning/engine.ts):
│   1 memory commands · follow-ups (deterministic)
│   2 local ambient filter (non-questions never reach the model)
│   3 router (fast model, JSON) → ignore | answer | research | clarify | tool
│   4a direct answer (streamed)       4b research: queries → search providers → dedupe →
│                                        rank (topicality + credibility + recency) → read pages
│                                        (SSRF-safe, robots.txt) → synthesis (JSON) → citation
│                                        validation → established / disputed / uncertainty
│   4c clarify                        4d tool proposal → validate → run or ask to confirm
│   5 persist history · memory proposals (user approves)
│ Providers: LLM (Gemini | mock) · search (Tavily | Brave | Gemini grounding | Wikipedia | mock)
│ Postgres via Drizzle: PGlite (embedded) or DATABASE_URL
└─────────────────────────────────────────────────────────────────────────┘
```

## Project structure

```
src/
  app/                     Next.js pages and API routes
    page.tsx, login/       dashboard (client) and sign-in
    api/assistant          one assistant turn, streamed as NDJSON events
    api/stt/token          single-use Gemini Live token (key stays on server)
    api/stt/transcribe     transcribe uploaded/command audio
    api/tts                natural voice (Gemini TTS → WAV)
    api/auth/*             register, login, logout, me
    api/memories, conversations, settings, feedback, actions/[id], notes,
    api/configs, eval, status, account, documents/summarize
  components/              UI (Dashboard, Orb, AnswerCard, panels, Markdown)
  lib/
    client/                browser-only: audio capture, wake word, transcribers,
                           ListeningController, SpeechPlayer, useJarvis hook
    server/                server-only: config, db (schema/client), auth, http,
                           llm/, search/, research/, reasoning/, tools/, eval/,
                           memory, settings, usage (budget), audit, rate limit, cache
    shared/                pure logic used by both: VAD, follow-ups, question detector,
                           settings schema, event types, wake-word engine, companion protocol
drizzle/                   SQL migrations (applied automatically at startup)
public/models/wakeword/    openWakeWord ONNX models   public/ort/  onnxruntime-web (copied on install)
public/worklets/           PCM capture AudioWorklet   public/sw.js  service worker
scripts/                   eval, wake-word check, secret check, icon renderer
tests/                     unit + integration (Vitest)   e2e/  browser tests (Playwright)
```

## Key design decisions

| Decision | Why |
| --- | --- |
| Wake word runs in the browser (openWakeWord + onnxruntime-web, ~3.7 MB, cached) | No audio leaves the device until “Hey JARVIS”; no per-minute cost. |
| Pre-roll + transcript double-check | The pre-roll contains the wake phrase, so the server transcript can confirm “Jarvis” was said and reject sound-alikes. |
| Router + small steps instead of one big prompt | Cheaper (fast model for routing), testable, and each step can be versioned and evaluated. |
| Prompt configs stored as versioned rows | Compare candidates against a stable test set, activate, and roll back without deploying code. |
| Research sources are untrusted data | Wrapped in `<source>` tags, stripped of fake delimiters; tools are chosen from the user's utterance before any web content is read, so pages can't trigger actions. |
| Citations validated server-side | Numbers that don't match a real source are removed; uncited research answers get their claim sources attached or are marked unverified. |
| PGlite fallback | Real Postgres with zero setup for local use; the same schema and migrations run on any Postgres in production. |
| NDJSON streaming | Status, sources and answer text arrive progressively over a plain `fetch`, which works everywhere. |

## Model routing and cost control

- Router, follow-ups, memory extraction and simple answers use `GEMINI_FAST_MODEL`; complex answers
  and research synthesis use `GEMINI_MODEL`.
- When a user passes 80% of `JARVIS_DAILY_REQUEST_BUDGET`, everything routes to the fast model; at
  100%, requests are refused until the next day.
- Transient 5xx errors are retried with backoff, then fall back to the fast model.
- Ambient speech is filtered locally before any model call. Search results (15 min), pages (30 min),
  robots.txt (1 h) and TTS audio (1 h) are cached.
