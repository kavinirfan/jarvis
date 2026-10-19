# Platform compatibility

JARVIS's shared client is a web app. What it can do depends on what each browser and operating
system allows. Only **macOS + Chrome** was tested end-to-end (see TESTING.md); the rest of this
table reflects documented platform behavior and is **unverified** on real devices.

| Capability | macOS (Chrome/Edge) | macOS Safari | Windows (Chrome/Edge) | Linux (Chrome) | Android (Chrome) | iPhone / iPad (Safari) |
| --- | --- | --- | --- | --- | --- | --- |
| Install as app (PWA) | ✅ | ✅ (Add to Dock) | ✅ | ✅ | ✅ | ✅ (Add to Home Screen) |
| Microphone + on-device wake word | ✅ **tested** | ✅ expected | ✅ expected | ✅ expected | ✅ expected | ✅ expected (iOS 16.4+) |
| Gemini streaming transcription | ✅ **tested** | ✅ expected | ✅ expected | ✅ expected | ✅ expected | ✅ expected |
| Browser speech recognition engine | ✅ (audio sent to Google) | ✅ (Apple) | ✅ | ⚠️ often missing | ✅ | ✅ |
| Natural voice / browser voice | ✅ **tested** | ✅ | ✅ | ✅ | ✅ | ✅ (after first tap) |
| Tab audio sharing | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ |
| Whole-system audio sharing | ✅ macOS 14.2+ with Chrome 141+ | ❌ | ✅ | ⚠️ PipeWire-dependent | ❌ | ❌ |
| Keeps listening with the tab in the background | ✅ (tab open) | ⚠️ may throttle | ✅ (tab open) | ✅ (tab open) | ❌ stops when backgrounded | ❌ stops when backgrounded |
| Listening while the device is locked | ❌ | ❌ | ❌ | ❌ | ❌ (needs native app) | ❌ (needs native app) |
| Listening with the browser closed | ❌ (needs native companion) | ❌ | ❌ | ❌ | ❌ | ❌ |

## Why some things need a native companion

- **Locked phones / background apps:** iOS and Android suspend web pages that aren't visible and
  revoke microphone access. JARVIS shows a notice when the tab goes to the background and never
  tries to work around this. Always-on listening needs a native app with a foreground service
  (Android) or an audio background mode (iOS, which is limited by App Store rules).
- **System audio:** only Chromium desktop browsers can share tab or system audio, and only through
  the user's share dialog each time. Other setups need a native companion (ScreenCaptureKit on
  macOS, WASAPI loopback on Windows, PipeWire on Linux) or a virtual audio device such as BlackHole
  (macOS) or VB-Cable (Windows), selected as the microphone in Settings → Audio input.
- **OS actions** (open apps, media keys, reminders, sending messages) aren't available to web pages.

The integration interface is defined in `src/lib/shared/companion.ts`; see NATIVE.md.

## Requirements

- HTTPS (or `localhost`) for microphone access and PWA install.
- A current browser: Chrome/Edge 120+, Safari 17+, Firefox 125+ (Firefox lacks tab-audio sharing).
- About 4 MB downloaded once for the wake-word models and runtime (cached by the service worker).
