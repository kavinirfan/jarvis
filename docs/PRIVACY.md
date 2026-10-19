# Privacy and security

## What is captured, where it goes, and when

| Situation | Microphone | Leaves the device? |
| --- | --- | --- |
| Listening off (default) | Off. No stream is open. | Nothing. |
| Wake mode, waiting for “Hey JARVIS” | On (MIC LIVE badge shown) | **No.** Audio is analysed in the browser by the on-device wake-word model and kept only in a 1.5 s rolling buffer. |
| After “Hey JARVIS” | On | The command clip (pre-roll + your question, ≤ 15 s) goes to your JARVIS server, then to Google Gemini for transcription. |
| Ambient mode | On | Speech is streamed to Gemini for transcription while listening is on. Streaming pauses after the silence timeout. |
| Shared tab/system audio | Only what you pick in the browser's share dialog | Streamed to Gemini for transcription, labelled “system”. |
| Stop Listening | Every track is stopped, the audio graph and transcription sockets are closed, buffers are cleared. Verified by an automated test. | Nothing. |

- The browser's own recording indicator and JARVIS's **MIC LIVE** badge are always visible during capture.
- JARVIS never starts listening on its own. Each session starts with your click, and your
  browser asks for microphone permission.
- On phones, browsers stop the microphone when JARVIS is in the background. JARVIS doesn't try to
  work around this.

## What is stored

| Data | Stored? | Control |
| --- | --- | --- |
| Your questions and JARVIS's answers (with sources) | Yes, in your account | History tab: search and delete; Settings → Privacy: retention (default 90 days), delete all |
| Ambient transcripts | **No** by default (kept only in the open tab's memory) | Settings → Privacy → “Save nearby-speech transcripts” (off) |
| Raw audio | **Never** stored | — |
| Memories | Only when you say “remember…”, add one yourself, or approve a suggestion | Memory tab: edit, search, export, delete one or all; turn memory off |
| Settings | Yes | Settings |
| Usage counts, failures, audit log of tool actions and privacy changes | Yes (no content, only metadata) | Deleted with your account |

**Memory isn't training.** Approved memories are short notes added to JARVIS's instructions when
relevant. They don't change the Gemini model. Suggested memories are marked *proposed* and are never
used until you approve them. Inferences are labelled separately from facts and preferences.

Export everything: Settings → Privacy → **Export all my data** (JSON). Delete everything:
**Delete account** (asks for your password).

## Third parties

- **Google Gemini** (AI, transcription, voice): receives questions, relevant context, approved
  memories, and audio as described above. On Gemini's free tier, Google may use data to improve
  its products; use a paid tier for stricter data terms.
- **Search provider** (Tavily, Brave or Wikipedia): receives search queries only.
- **Websites** JARVIS reads during research: receive a normal page request (User-Agent `JARVIS/0.1`).
- The browser engine for “Browser built-in” speech recognition sends audio to Google (Chrome) or
  Apple (Safari). It's off by default.

Recording laws differ by place. Many require everyone's consent before conversations are recorded
or transcribed. Use ambient mode and system-audio capture only where you're allowed to.

## Security measures

- **Secrets:** API keys live only in server environment variables. The browser gets a
  **single-use, short-lived token** that's locked to the transcription model and can't be used for
  anything else. `npm run check:secrets` scans committable files, the browser bundle,
  `.env.example` and logging for leaks.
- **Accounts:** scrypt password hashing. Session cookies are random 256-bit tokens, `HttpOnly`,
  `SameSite=Lax`, and `Secure` in production; the database stores only their SHA-256 hash.
  Failed logins are rate-limited. Only the first account can register unless
  `JARVIS_ALLOW_REGISTRATION=true`.
- **Authorization:** every data query is scoped to the signed-in user. Tests verify that one
  account can't read, edit, delete or confirm another account's data.
- **Request safety:** same-origin checks on every state-changing request, zod validation of all
  input, body-size limits, per-user rate limits and a daily request budget.
- **Headers:** a Content-Security-Policy that only allows connections to this site and Gemini's
  WebSocket, `X-Frame-Options: DENY`, `nosniff`, and a Permissions-Policy limiting the microphone to this site.
- **Untrusted content:** web pages, documents and transcripts are passed to the model as quoted data
  with instructions to ignore any commands inside them. Fake delimiters are stripped. Tools are
  chosen from your own words before any web content is read.
- **Page fetching:** http(s) only, public IPs only (blocks localhost, private networks and cloud
  metadata endpoints), every redirect re-checked, robots.txt respected, 6 s timeout, 1.5 MB limit.
- **Tools:** an allow-list of low-risk tools. Arguments are validated, every call is audited and
  limited to 5 s. Sensitive actions (opening sites, deleting notes) need explicit approval, and
  each approval works once, for 10 minutes, and only for its owner. There is **no** shell,
  file-system, purchase, or message-sending tool, and the model can't add tools or permissions.
- **Model output** is rendered with a safe Markdown renderer (no raw HTML), and links open with
  `noopener noreferrer`.

### Residual risks

- DNS rebinding between the address check and the fetch isn't fully prevented (it's mitigated by
  re-checking redirects). Run the server where it can't reach sensitive internal services.
- The in-memory rate limiter and caches are per server process. Use a shared store (Redis) for
  multi-instance hosting.
- Prompt injection can't be fully eliminated. It's contained by giving the model no dangerous tools.
