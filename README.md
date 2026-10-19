# JARVIS — personal AI assistant

JARVIS is a voice assistant you run yourself. Say **“Hey JARVIS”** and ask a question. It
transcribes what you said, decides whether it can answer directly or needs to research the web,
reads and cross-checks sources, then speaks a short answer while showing the full answer with
clickable citations. It remembers things only when you approve them, and it works in any modern
browser on macOS, Windows, Linux, Android, iPhone and iPad (installable as an app).

It's a software assistant built on Google Gemini. It isn't conscious, and adding memories
personalizes its answers; it doesn't retrain the AI model.

---

## Quick start (local)

You need **Node.js 22 or newer** (`node -v`). No database install is needed.

```bash
cd ~/Projects/jarvis
npm install
cp .env.example .env.local     # skip if .env.local already exists
# open .env.local and paste your key after GEMINI_API_KEY=
npm run dev
```

Open **http://localhost:3000**, create your account (the first account becomes the owner), and
press **Enable Listening**. Allow the microphone when the browser asks.

> Port 3000 busy (for example by Crackin)? Run `npm run dev -- -p 3100` and open http://localhost:3100.

**Production mode on your computer** (faster, what you'd deploy):

```bash
npm run build
npm start                      # http://localhost:3000
```

### Your API keys

| Variable | Needed for | Where to get it |
| --- | --- | --- |
| `GEMINI_API_KEY` | AI answers, speech-to-text, natural voice | https://aistudio.google.com/apikey (free tier available) |
| `TAVILY_API_KEY` *(recommended)* | Up-to-date web search | https://tavily.com (free tier) |
| `BRAVE_SEARCH_API_KEY` *(alternative)* | Web search | https://api.search.brave.com |
| `DATABASE_URL` *(production)* | Shared PostgreSQL database | Any Postgres host (Neon, Supabase, RDS, …) |

Keys live only in `.env.local` on the server. They're never sent to the browser, logged, or
committed (`npm run check:secrets` verifies this). Restart the server after editing `.env.local`.

- **No Gemini key:** JARVIS runs in **mock mode**. Every answer is labelled “Mock output — not
  real AI”, and you can still try the interface.
- **No search key:** research uses **Wikipedia** only. It works for background facts but misses
  breaking news. The Status panel says so.
- **Gemini's free tier:** Google Search grounding isn't included (it returns a quota error), so it's
  off by default. The free tier's natural-voice (TTS) quota is small; when it runs out, JARVIS
  switches to the browser's built-in voice automatically.

## Using JARVIS

1. **Enable Listening.** The red **MIC LIVE** badge in the header stays visible whenever audio is captured.
2. Say **“Hey JARVIS, …”**. In **wake mode** (the default), a small model running *on your device*
   listens for the phrase, and nothing is uploaded until you say it.
3. Ask follow-ups: *“Explain that again”*, *“Go deeper”*, *“Give me an example”*,
   *“Summarize the last five minutes.”*
4. **Stop speaking** cuts the voice instantly. Saying “Hey JARVIS” while it talks interrupts it too.
5. **Stop Listening** ends microphone capture immediately; nothing keeps recording.

Other ways to ask: type in the box, press **Research** to force a cited web search, upload a
recording (♪), or summarize a PDF or text document (⎘).

**Ambient mode** (Settings → Audio input): JARVIS continuously transcribes nearby speech and
answers factual questions it overhears (“does anyone know…”), while ignoring chit-chat. This
streams audio to Gemini while listening is on. It pauses after a configurable silence to save
power, and resumes when someone speaks.

**Computer / tab audio** (Settings → Audio input, Chrome or Edge on a computer): share a browser tab
or your screen with audio. Its transcript is labelled **system**, separate from the microphone.

**Memory:** say *“Remember that I prefer short answers”*, or approve the suggestions JARVIS
offers. You can edit, search, export and delete memories in the **Memory** tab, or turn memory off
in **Settings → Privacy**. Memories sync to every device where you're signed in.

**Tools:** notes, tasks, history search, message drafts (never sent), and opening websites (asks
for confirmation first). Deleting notes also asks for confirmation. There's no shell or
file-system tool.

## Install as an app (PWA)

The app must be served over **HTTPS**, or from `localhost` on the same computer.

| Device | How |
| --- | --- |
| Chrome / Edge (desktop) | Address bar install icon, or ⋮ → *Cast, save and share* → *Install page as app* |
| Android (Chrome) | ⋮ → *Add to Home screen* → *Install* |
| iPhone / iPad (Safari) | Share → *Add to Home Screen* |
| macOS Safari 17+ | File → *Add to Dock* |

## Commands

```bash
npm run dev             # development server
npm run build && npm start
npm test                # unit + integration tests (mock AI, in-memory Postgres)
npm run test:e2e        # browser tests with real services (server must be running; see docs/TESTING.md)
npm run check:wakeword  # on-device wake word vs. synthesized speech (macOS `say`)
npm run eval            # score the active prompt config on the evaluation set (real API calls)
npm run eval -- --candidate '{"temperature":0.2}'   # compare a candidate config to the active one
npm run check:secrets   # make sure no key can leak
npm run test:all        # typecheck + lint + tests + secret check
```

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how it works, project structure
- [docs/PLATFORMS.md](docs/PLATFORMS.md): platform compatibility matrix and limitations
- [docs/PRIVACY.md](docs/PRIVACY.md): privacy and security
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): production deployment guide
- [docs/TESTING.md](docs/TESTING.md): testing report and how to run every test
- [docs/NATIVE.md](docs/NATIVE.md): native companion apps (background listening, system audio, OS actions)

## Known limitations (summary)

- Browsers stop the microphone when the tab is closed, and mobile browsers stop it when the app
  is in the background or the phone is locked. Always-on listening needs a native companion (docs/NATIVE.md).
- The wake-word model can occasionally trigger on sound-alikes (“Hey Travis”). The default
  double-check against the transcript filters these out.
- Without a web-search key, research is limited to Wikipedia.
- The free Gemini tier has tight rate limits. JARVIS retries, falls back to a faster model, and
  reports quota errors clearly.

See docs/PLATFORMS.md and docs/TESTING.md for full details.

## Credits

- Wake word: [openWakeWord](https://github.com/dscripka/openWakeWord) (Apache-2.0 code). The
  pre-trained `hey_jarvis` model is licensed **CC BY-NC-SA 4.0**: fine for personal, non-commercial
  use. For commercial use, train your own model or use a commercial engine (for example Picovoice Porcupine).
- Streaming transcription, token handling, the audio worklet and question detection were adapted from
  the earlier **Crackin** project (`~/Projects/crackin`), which is unchanged.
