/**
 * Native companion protocol (interface only — no native app ships yet; see docs/NATIVE.md).
 *
 * Browsers can't listen in the background, capture system audio on every platform, or run
 * OS-level actions. A small native companion (menu-bar app on macOS, tray app on Windows/Linux,
 * foreground-service app on Android, app + widget on iOS) fills those gaps and talks to JARVIS
 * through this contract. It reuses the same backend, account and memories: the companion signs
 * in with the user's session, then either streams audio to the existing endpoints or forwards
 * events to an open JARVIS tab over a localhost WebSocket.
 *
 * Transport: WebSocket at ws://127.0.0.1:<port>/jarvis (default 47800), JSON text frames,
 * binary frames for PCM. The page must allow it in Content-Security-Policy `connect-src`.
 */

export const COMPANION_PROTOCOL_VERSION = 1;
export const COMPANION_DEFAULT_URL = "ws://127.0.0.1:47800/jarvis";

/** What a companion can do; the page enables only features the companion advertises. */
export interface CompanionCapabilities {
  /** Keeps listening for "Hey JARVIS" when the browser is closed or the device is locked (where the OS permits). */
  backgroundWakeWord: boolean;
  /** Captures audio output of the whole system or a chosen app (e.g. ScreenCaptureKit, WASAPI loopback, PipeWire). */
  systemAudio: boolean;
  /** Can perform OS actions from the allow-list below after explicit user confirmation. */
  actions: CompanionActionName[];
}

/** OS-level actions a companion may implement. Each requires on-device confirmation. */
export type CompanionActionName = "open_app" | "open_url" | "set_volume" | "media_play_pause" | "create_reminder" | "send_message";

/** Page → companion */
export type PageToCompanion =
  | { type: "hello"; protocol: number; origin: string }
  | { type: "start_system_audio"; sampleRate: 16000; sourceId?: string }
  | { type: "stop_system_audio" }
  | { type: "set_wake"; enabled: boolean; threshold: number }
  | { type: "action_request"; id: string; action: CompanionActionName; args: Record<string, unknown>; summary: string };

/** Companion → page. PCM arrives as binary frames: 16 kHz, 16-bit little-endian mono, 100 ms chunks. */
export type CompanionToPage =
  | { type: "welcome"; protocol: number; name: string; platform: "macos" | "windows" | "linux" | "android" | "ios"; capabilities: CompanionCapabilities }
  | { type: "system_audio_started"; sourceLabel: string }
  | { type: "system_audio_stopped"; reason?: string }
  | { type: "wake"; score: number; at: string }
  | { type: "action_result"; id: string; status: "done" | "denied_by_user" | "failed" | "unsupported"; message?: string }
  | { type: "error"; message: string };

/** Pairing guard: the companion only accepts pages from origins the user approved on-device. */
export interface CompanionPairing {
  origin: string;
  approvedAt: string;
}
