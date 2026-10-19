import type { CaptureStatus } from "./audio/controller";
import type { PlayerState } from "./speech/player";

export type Phase = "off" | "starting" | "listening" | "standby" | "capturing" | "transcribing" | "thinking" | "researching" | "speaking" | "error";

/** One displayed status for the orb, combining audio and assistant state. Pure; unit-tested. */
export function derivePhase(s: { capture: CaptureStatus; commandCapture: boolean; transcribing: boolean; busy: null | "thinking" | "researching"; player: PlayerState }): Phase {
  if (s.player === "speaking" || s.player === "loading" || s.player === "paused") return "speaking";
  if (s.busy) return s.busy;
  if (s.transcribing) return "transcribing";
  if (s.commandCapture) return "capturing";
  if (s.capture === "error") return "error";
  if (s.capture === "starting" || s.capture === "reconnecting") return "starting";
  if (s.capture === "standby") return "standby";
  if (s.capture === "on") return "listening";
  return "off";
}
