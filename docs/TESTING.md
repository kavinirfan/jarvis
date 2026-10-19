# Testing report

Tested on **2026-10-19**: macOS (Darwin 25.5), Node 24.18, Google Chrome (stable) driven by
Playwright 1.64, Gemini key from the existing Crackin project, no web-search key (Wikipedia provider).

## Results

| Suite | Command | Result |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | ✅ clean |
| Lint | `npm run lint` | ✅ clean |
| Unit tests (VAD, wake-phrase verification, echo guard, follow-ups, question detection, citations, dedupe, credibility + topicality ranking, HTML extraction, SSRF guard, robots.txt, cache, rate limit, memory commands, speech chunking, UI phase) | `npm test` | ✅ 32 passed |
| Integration tests (real route handlers + in-memory Postgres + mock AI): auth, sessions, cross-site rejection, authorization between accounts, settings, assistant routing, research with flagged mock sources, follow-ups, transcript summary, ambient filtering with no AI call, history search, feedback → eval set, memory commands/sync/privacy/export/delete/approved-only, tools, confirmations (owner-only, single-use, audited), config activate/rollback, daily budget, citation repair | `npm test` | ✅ 31 passed |
| On-device wake word vs. real synthesized speech (4 voices) | `npm run check:wakeword` | ✅ 20/20 (8 “Hey Jarvis” detected, peak ≈ 0.99; 12 ordinary sentences rejected, peak ≤ 0.01) |
| Secret exposure (committable files, client bundle, `.env.example`, logging, git-ignore) | `npm run check:secrets` | ✅ clean; also verified it **fails** when a key is planted |
| Production build | `npm run build` | ✅ |
| Browser E2E on the production build (`npm start`), real Gemini + real web | `npm run test:e2e` | ✅ 9 passed |
| Evaluation of prompt config 2026.10.2 (real Gemini, stable set) | `npm run eval` | ✅ route 1.00 · mode 1.00 · relevance 1.00 · tools 1.00 · citations 1.00 · sentence-level grounding 0.50 · 0 errors · 2.5 s mean latency |

## The full workflow (requested 15 steps)

Run in real Chrome against the production build, with Chrome's fake-microphone device playing a
synthesized recording of “Hey Jarvis… what is the capital of France?” (`e2e/full-flow.spec.ts`).

| # | Step | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Launch JARVIS | ✅ | production server, dashboard loads |
| 2 | Sign in | ✅ | real account, session cookie |
| 3 | Enable listening | ✅ | MIC LIVE badge; `captureLive()` true; wake model ready at 1.6 s |
| 4 | Activate “Hey JARVIS” | ✅ | detected **on-device** at ~5.5 s (phrase starts at ~5.6 s in the recording) |
| 5 | Ask a question aloud | ✅ | command recorded until the pause |
| 6 | Transcribe and understand | ✅ | Gemini transcription; second-stage check found “Jarvis”; router → answer |
| 7 | Search the internet | ✅ | separate research test: Wikipedia search, 3 pages read |
| 8 | Grounded answer with real citations | ✅ | Eiffel Tower answer contains 1889; every citation links to a listed source; cited URLs fetched with HTTP < 400 |
| 9 | Speak the answer | ✅ | player state `speaking` (audio actually playing) |
| 10 | Interrupt | ✅ | Stop → player `idle` within ~1 s |
| 11 | Follow-up question | ✅ | “And roughly how many people live there?” answered about Paris (“million”) |
| 12 | Save an approved memory | ✅ | “Remember that my test code word is AURORA-…” saved |
| 13 | Retrieve on another session | ✅ | separate browser context signed in, Memory tab shows it |
| 14 | Disable listening | ✅ | MIC OFF badge |
| 15 | Verify capture stopped | ✅ | every MediaStreamTrack `ended`; controller inactive |

Ambient mode (`e2e/ambient.spec.ts`): ✅ continuous Gemini Live streaming over WebSocket (under the
production CSP) transcribed chatter and an overheard question, ignored “I think we should get pizza
tonight”, and answered “Does anyone know how far away the Moon is…” with one answer only.

Responsive UI (`e2e/responsive.spec.ts`): ✅ 360×740, 393×852, 820×1180, 1366×820 and 1920×1080 with
no horizontal scrolling and every panel reachable; reduced-motion disables animation.

## What is NOT verified (be aware)

| Item | Status | Why |
| --- | --- | --- |
| A real human voice through a physical microphone | **Unverified** | Tests use Chrome's fake device fed with macOS-synthesized speech. Real rooms add noise and echo; tune *Wake-word sensitivity* if needed. |
| Gemini natural voice played in the browser in the final runs | **Partially verified** | `/api/tts` returned valid WAV and transcribing it gave the exact sentence back. In the final E2E runs, Gemini's free-tier TTS quota was exhausted, so the browser voice fallback played (which is the designed behavior). |
| Echo cancellation / feedback loop with real speakers | **Unverified** | Needs physical speakers + microphone. Code-level guards (browser AEC, transcript-overlap filter, raised wake threshold while speaking) are unit-tested. |
| Tab/system audio capture | **Unverified** | The browser share dialog can't be automated reliably; the code path matches Crackin's, which was used on real calls. |
| Windows, Linux, Android, iOS, Safari, Firefox | **Unverified** | Only macOS + Chrome was available. See PLATFORMS.md. |
| Tavily / Brave search providers | **Unverified** | No keys available; implemented to their documented APIs. |
| Gemini Google Search grounding | **Blocked** | The free-tier key returns 429 “quota exceeded” for the `google_search` tool. |
| PostgreSQL server (`DATABASE_URL`) | **Unverified** | No Postgres server installed. The same Drizzle schema/migrations ran on PGlite (real Postgres in WASM). |
| Public HTTPS deployment | **Not done** | No hosting account or approval; see DEPLOYMENT.md. |
| Real-device PWA install | **Unverified** | Manifest, icons and service worker are served; install not exercised on devices. |

## Bugs found by testing and fixed

1. Gemini's transcription model returns `audioTranscription` parts, not `text`, so uploads came back empty. Fixed the parser.
2. Transient Gemini 503 errors failed research answers. Added retry with backoff and fallback to the fast model.
3. After a fallback, answers reported the wrong model. They now report the model that actually answered.
4. Overheard factual questions were ignored in ambient mode. Fixed the router instructions as config version 2026.10.2 (2026.10.1 is kept for rollback).
5. Research read the wrong pages (all Wikipedia results tied on credibility). Added topicality ranking; the Japan-population answer went from “sources don't say” to a cited figure.
6. The model sometimes omitted inline citations. Uncited research answers now get their claim sources attached, or are marked low-confidence and unverified.
7. Successful logins counted toward the failed-login lockout. Only failures count now.
8. Repeated natural-voice requests after a quota error. Added a 60 s cooldown that uses the browser voice.
9. Mobile header too translucent while scrolling. Made it more opaque.

## Running the tests yourself

```bash
npm run test:all                     # typecheck, lint, unit+integration, secret check

# Browser E2E (uses real services, so it costs a few Gemini calls). Needs a running server and an account:
PGLITE_DIR=.data/e2e npm run dev -- -p 3100        # terminal 1
curl -s -H 'content-type: application/json' -H 'origin: http://localhost:3100' \
  -d '{"email":"tester@example.com","password":"correct horse battery"}' http://localhost:3100/api/auth/register
npm run test:e2e                     # terminal 2 (a Chrome window opens: headless Chrome can't use the mic on macOS)
```

E2E uses `E2E_BASE_URL`, `E2E_EMAIL` and `E2E_PASSWORD` if set. Use a separate `PGLITE_DIR` so test
accounts never mix with your real data.
