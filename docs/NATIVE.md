# Native companions (not built yet)

The web app covers foreground use on every platform. A small native **companion** would add what
browsers can't do:

| Need | macOS | Windows | Linux | Android | iOS/iPadOS |
| --- | --- | --- | --- | --- | --- |
| Wake word with the browser closed | Menu-bar app running openWakeWord or Porcupine | Tray app | Tray app / systemd user service | Foreground service with a persistent notification (required by Android) | Very limited: background audio is restricted by iOS and App Store policy. Realistic options are a Shortcut / Siri phrase (“Hey Siri, ask JARVIS…”) or the app in the foreground. |
| System audio | ScreenCaptureKit (macOS 13+), or BlackHole as an input device | WASAPI loopback, or VB-Cable | PipeWire / PulseAudio monitor source | MediaProjection audio capture (Android 10+, only apps that allow it) | Not available to third-party apps |
| OS actions | AppleScript / Shortcuts with per-action confirmation | PowerShell / UI Automation, allow-listed | D-Bus, allow-listed | Intents | Shortcuts / App Intents |

## Integration contract

Defined in `src/lib/shared/companion.ts` (version 1):

- The companion runs a WebSocket server on `ws://127.0.0.1:47800/jarvis`. It accepts only page
  origins the user has approved **on the device** (pairing), and never accepts remote connections.
- The page sends `hello`; the companion replies `welcome` with its platform and
  `capabilities` (`backgroundWakeWord`, `systemAudio`, `actions`).
- System audio: `start_system_audio` → binary frames of 16 kHz 16-bit mono PCM in 100 ms chunks.
  These go into the same Gemini Live transcriber the browser uses, labelled `system`.
- Wake word: the companion sends `wake` events. When the browser is closed, the companion can
  instead record the command and call the existing server APIs (`/api/stt/transcribe`, then
  `/api/assistant`) with the user's session, so history and memory stay unified.
- Actions: `action_request` with an allow-listed action name. The companion **must** show its own
  confirmation dialog and reply `action_result`. The server-side tool registry and audit log apply
  unchanged.

## Remaining work to make it functional

1. Add the companion origin to `connect-src` in `next.config.ts` (behind a setting).
2. Build a `CompanionAudioSource` client that feeds binary PCM frames into `GeminiLiveTranscriber`,
   and add a “Companion” option to Settings → Audio input.
3. Add a device sign-in flow for companions (short-lived device codes, so the companion never sees
   the password), stored as a separate session type that can be revoked.
4. Build each native app: macOS (Swift + ScreenCaptureKit + onnxruntime), Windows (C#/.NET +
   NAudio WASAPI loopback), Android (Kotlin foreground service), Linux (Rust/Python + PipeWire).
5. Code-sign and notarize the desktop apps; ship the Android app through Play with
   foreground-service declarations.

The earlier Crackin project's `docs/desktop-macos.md` describes a macOS system-audio approach
that can be reused for step 4.
