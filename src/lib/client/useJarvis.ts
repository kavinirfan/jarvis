"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AssistantEvent, FinalAnswer, MemoryProposal, PublicSourceDto, TranscriptSegment } from "@/lib/shared/events";
import { stripWakePhrase } from "@/lib/shared/followups";
import { QuestionDetector } from "@/lib/shared/questionDetector";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/shared/settings";
import { containsWakeName, overlapRatio } from "@/lib/shared/vad";
import { api, ApiError, streamAssistant } from "./api";
import { pcmToWav } from "./audio/capture";
import { ListeningController, type CaptureStatus } from "./audio/controller";
import type { TranscriberStatus } from "./audio/geminiTranscriber";
import { derivePhase } from "./phase";
import { SpeechPlayer, type PlayerState } from "./speech/player";

export { derivePhase, type Phase } from "./phase";

export interface ResearchStep {
  at: number;
  stage: string;
  detail?: string;
}

export interface Turn {
  id: string;
  question: string;
  trigger: string;
  status: "streaming" | "done" | "error" | "ignored";
  text: string;
  answer: FinalAnswer | null;
  sources: PublicSourceDto[];
  steps: ResearchStep[];
  warnings: string[];
  error?: string;
  messageId?: string | null;
  route?: { action: string; question: string; complexity: string; model: string };
  latencyMs?: number;
  confirmation?: { actionId: string; summary: string; risk: string; tool: string; resolved?: "approved" | "cancelled" };
  toolResult?: { tool: string; summary: string; clientAction?: { type: "open_url"; url: string } };
  /** Everything JARVIS did on the way to the answer. */
  actions?: { tool: string; summary: string }[];
}

const MAX_SEGMENTS = 400;
const CONTEXT_MINUTES = 10;

export function useJarvis(settings: Settings = DEFAULT_SETTINGS) {
  const [capture, setCapture] = useState<CaptureStatus>("off");
  const [captureDetail, setCaptureDetail] = useState<string>("");
  const [level, setLevel] = useState(0);
  const [wakeEngine, setWakeEngine] = useState<"idle" | "loading" | "ready" | "unavailable">("idle");
  const [transcriber, setTranscriber] = useState<{ status: TranscriberStatus | "idle"; detail?: string }>({ status: "idle" });
  const [commandCapture, setCommandCapture] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [busy, setBusy] = useState<null | "thinking" | "researching">(null);
  const [player, setPlayer] = useState<PlayerState>("idle");
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [interim, setInterim] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [proposals, setProposals] = useState<MemoryProposal[]>([]);
  const [notice, setNotice] = useState<string>("");
  const [systemAudio, setSystemAudio] = useState(false);
  const [lastWakeAt, setLastWakeAt] = useState<number | null>(null);

  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  const segmentsRef = useRef<TranscriptSegment[]>([]);
  const conversationRef = useRef<string | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const addressedUntil = useRef(0); // ambient mode: after a wake word, the next utterance is a command
  const playerRef = useRef<SpeechPlayer | null>(null);
  const controllerRef = useRef<ListeningController | null>(null);
  const detectorRef = useRef<QuestionDetector | null>(null);

  const flash = useCallback((msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice((n) => (n === msg ? "" : n)), 6000);
  }, []);

  const updateTurn = useCallback((id: string, f: (t: Turn) => Turn) => setTurns((ts) => ts.map((t) => (t.id === id ? f(t) : t))), []);

  const addSegment = useCallback((text: string, source: TranscriptSegment["source"]) => {
    const seg = { at: new Date().toISOString(), text, source };
    const cutoff = Date.now() - 60 * 60_000;
    segmentsRef.current = [...segmentsRef.current.filter((s) => Date.parse(s.at) > cutoff), seg].slice(-MAX_SEGMENTS);
    setSegments(segmentsRef.current);
  }, []);

  // ---- asking ---------------------------------------------------------------------------------

  const ask = useCallback(
    async (rawText: string, trigger: "wake" | "ambient" | "typed" | "upload", force?: "research" | "direct") => {
      const text = rawText.trim();
      if (!text) return;
      // A new question interrupts the previous answer and any speech.
      abortRef.current?.abort();
      playerRef.current?.stop();
      const ac = new AbortController();
      abortRef.current = ac;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setTurns((ts) => [...ts.slice(-30), { id, question: text, trigger, status: "streaming", text: "", answer: null, sources: [], steps: [], warnings: [] }]);
      setBusy("thinking");
      const since = Date.now() - CONTEXT_MINUTES * 60_000;
      let finalAnswer: FinalAnswer | null = null;

      const onEvent = (e: AssistantEvent) => {
        switch (e.type) {
          case "meta":
            conversationRef.current = e.conversationId;
            setConversationId(e.conversationId);
            break;
          case "status":
            if (e.stage === "searching" || e.stage === "reading" || e.stage === "synthesizing") setBusy("researching");
            updateTurn(id, (t) => ({ ...t, steps: [...t.steps, { at: Date.now(), stage: e.stage, detail: e.detail }] }));
            break;
          case "route":
            updateTurn(id, (t) => ({ ...t, route: e }));
            break;
          case "sources":
            updateTurn(id, (t) => ({ ...t, sources: e.sources }));
            break;
          case "delta":
            updateTurn(id, (t) => ({ ...t, text: t.text + e.text }));
            break;
          case "warning":
            updateTurn(id, (t) => ({ ...t, warnings: [...t.warnings, e.message] }));
            break;
          case "ignored":
            updateTurn(id, (t) => ({ ...t, status: "ignored", text: e.reason }));
            break;
          case "answer":
            finalAnswer = e.answer;
            updateTurn(id, (t) => ({ ...t, answer: e.answer, text: e.answer.text, sources: e.answer.sources.length ? e.answer.sources : t.sources }));
            break;
          case "memory_saved":
            flash(`I'll remember: ${e.memory.content}`);
            break;
          case "memory_proposals":
            setProposals((p) => [...p, ...e.items]);
            break;
          case "tool_result":
            updateTurn(id, (t) => ({ ...t, toolResult: e, actions: [...(t.actions ?? []), { tool: e.tool, summary: e.summary }] }));
            if (e.clientAction?.type === "open_url") window.open(e.clientAction.url, "_blank", "noopener,noreferrer");
            break;
          case "tool_confirmation":
            updateTurn(id, (t) => ({ ...t, confirmation: e }));
            break;
          case "error":
            updateTurn(id, (t) => ({ ...t, status: "error", error: e.message }));
            break;
          case "done":
            updateTurn(id, (t) => ({ ...t, status: t.status === "streaming" ? "done" : t.status, messageId: e.messageId, latencyMs: e.latencyMs }));
            break;
        }
      };

      try {
        await streamAssistant(
          {
            text,
            trigger,
            force,
            conversationId: conversationRef.current,
            transcript: segmentsRef.current.filter((s) => Date.parse(s.at) >= since),
          },
          onEvent,
          ac.signal,
        );
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          updateTurn(id, (t) => ({ ...t, status: t.status === "streaming" ? "done" : t.status, warnings: [...t.warnings, "Interrupted."] }));
          return;
        }
        const msg = e instanceof ApiError ? e.message : "Something went wrong.";
        updateTurn(id, (t) => ({ ...t, status: "error", error: msg }));
        if (e instanceof ApiError && e.status === 401) window.location.replace("/login"); // full reload clears all state
      } finally {
        if (abortRef.current === ac) {
          abortRef.current = null;
          setBusy(null);
        }
      }
      const s = settingsRef.current;
      const spoken = (finalAnswer as FinalAnswer | null)?.spoken;
      if (spoken && s.voiceEnabled && !ac.signal.aborted) {
        void playerRef.current?.speak(spoken, { engine: s.voiceEngine, voice: s.voiceName, rate: s.speechRate, lang: s.responseLanguage === "auto" ? s.language : s.responseLanguage });
      }
    },
    [flash, updateTurn],
  );

  /** Stops speech and any in-flight answer immediately. */
  const interrupt = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    playerRef.current?.stop();
    setBusy(null);
  }, []);

  // ---- audio callbacks -------------------------------------------------------------------------

  const transcribeCommand = useCallback(
    async (chunks: Int16Array[]) => {
      setTranscribing(true);
      try {
        const form = new FormData();
        form.append("audio", pcmToWav(chunks), "command.wav");
        form.append("language", settingsRef.current.language);
        const { text } = await api<{ text: string; mock: boolean }>("/api/stt/transcribe", { method: "POST", body: form });
        if (!text.trim()) {
          flash("I didn't catch that. Say “Hey JARVIS” and try again.");
          return;
        }
        // Second-stage check: the transcript (which includes the pre-roll) must contain "Jarvis".
        if (settingsRef.current.strictWakeVerification && !containsWakeName(text)) {
          flash(`Ignored: heard “${text.slice(0, 60)}” but not the name JARVIS.`);
          return;
        }
        addSegment(text, "mic");
        const command = stripWakePhrase(text.replace(/^.*?\b(?=(?:hey|hi|okay|ok)?[\s,]*jarvis\b)/i, ""));
        if (!command) {
          flash("Yes? I'm listening.");
          controllerRef.current?.armCommand();
          return;
        }
        void ask(command, "wake");
      } catch (e) {
        flash(e instanceof ApiError ? e.message : "Transcription failed. Try again or type your question.");
      } finally {
        setTranscribing(false);
      }
    },
    [addSegment, ask, flash],
  );

  const handleFinal = useCallback(
    (text: string, source: "mic" | "system") => {
      const p = playerRef.current;
      // Feedback-loop guard: drop transcripts of JARVIS's own voice.
      if (p && (p.speaking || Date.now() - p.lastEndedAt < 2000) && overlapRatio(text, p.currentText || "") > 0.5) return;
      if (p?.speaking && source === "mic" && !containsWakeName(text)) {
        addSegment(text, source);
        return; // don't answer things heard while JARVIS is talking
      }
      addSegment(text, source);
      if (busy) return;
      if (containsWakeName(text)) {
        const after = stripWakePhrase(text.replace(/^.*?\b(?=(?:hey|hi|okay|ok)?[\s,]*jarvis\b)/i, ""));
        if (after.split(/\s+/).length >= 2) {
          addressedUntil.current = 0;
          void ask(after, "wake");
        } else addressedUntil.current = Date.now() + 8000;
        return;
      }
      if (Date.now() < addressedUntil.current) {
        addressedUntil.current = 0;
        void ask(text, "wake");
        return;
      }
      if (settingsRef.current.listenMode === "ambient") detectorRef.current?.push(text, Date.now());
    },
    [addSegment, ask, busy],
  );
  // Latest-callback refs for the long-lived audio controller.
  const handleFinalRef = useRef(handleFinal);
  const transcribeRef = useRef(transcribeCommand);
  const askRef = useRef(ask);
  useEffect(() => {
    handleFinalRef.current = handleFinal;
    transcribeRef.current = transcribeCommand;
    askRef.current = ask;
  }, [handleFinal, transcribeCommand, ask]);

  useEffect(() => {
    playerRef.current = new SpeechPlayer((s, detail) => {
      setPlayer(s);
      if (controllerRef.current) controllerRef.current.suppressed = s !== "idle";
      if (detail) flash(detail);
    });
    detectorRef.current = new QuestionDetector({ onQuestion: (q) => void askRef.current(q, "ambient") });
    const det = window.setInterval(() => detectorRef.current?.tick(Date.now()), 250);
    controllerRef.current = new ListeningController({
      onStatus: (s, d) => {
        setCapture(s);
        setCaptureDetail(d ?? "");
      },
      onLevel: setLevel,
      onWake: () => {
        setLastWakeAt(Date.now());
        // Barge-in: "Hey JARVIS" while it's talking stops the answer.
        if (playerRef.current?.speaking) playerRef.current.stop();
        abortRef.current?.abort();
        if (settingsRef.current.listenMode === "wake") setCommandCapture(true);
        else addressedUntil.current = Date.now() + 8000;
        earcon();
      },
      onCommandAudio: (chunks) => {
        setCommandCapture(false);
        void transcribeRef.current(chunks);
      },
      onCommandText: (text) => {
        setCommandCapture(false);
        addSegment(text, "mic");
        const command = stripWakePhrase(text);
        if (command) void askRef.current(command, "wake");
      },
      onCommandTimeout: () => {
        setCommandCapture(false);
        flash("I didn't hear a question after “Hey JARVIS”.");
      },
      onInterim: (t) => {
        setInterim(t);
        if (t) detectorRef.current?.touch(Date.now());
      },
      onFinal: (t, src) => {
        setInterim("");
        handleFinalRef.current(t, src);
      },
      onTranscriberStatus: (status, detail) => setTranscriber({ status, detail }),
      onWakeEngine: (s, d) => {
        setWakeEngine(s);
        if (d) flash(d);
      },
      onSystemAudio: (active, d) => {
        setSystemAudio(active);
        if (d) flash(d);
      },
    });
    const onHide = () => {
      if (document.hidden && controllerRef.current?.active) flash("JARVIS is in the background; your browser may pause listening.");
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.clearInterval(det);
      document.removeEventListener("visibilitychange", onHide);
      void controllerRef.current?.stop();
      playerRef.current?.stop();
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restart listening with new settings if they change while listening.
  const listenKey = `${settings.listenMode}|${settings.sttEngine}|${settings.language}|${settings.wakeThreshold}|${settings.silenceTimeoutSec}`;
  const deviceRef = useRef<string | undefined>(undefined);

  const enableListening = useCallback(async (deviceId?: string) => {
    if (deviceId !== undefined) deviceRef.current = deviceId || undefined;
    const s = settingsRef.current;
    try {
      await controllerRef.current?.start({
        mode: s.listenMode,
        sttEngine: s.sttEngine,
        language: s.language,
        deviceId: deviceRef.current,
        wakeThreshold: s.wakeThreshold,
        silenceTimeoutSec: s.silenceTimeoutSec,
      });
    } catch {
      // status callback already carries the message
    }
  }, []);

  const stopListening = useCallback(async () => {
    await controllerRef.current?.stop();
    setCommandCapture(false);
    setInterim("");
    setTranscriber({ status: "idle" });
    setWakeEngine("idle");
  }, []);

  const prevKey = useRef(listenKey);
  useEffect(() => {
    if (prevKey.current !== listenKey) {
      prevKey.current = listenKey;
      if (controllerRef.current?.active) void enableListening();
    }
  }, [listenKey, enableListening]);

  // Expose real capture state for automated tests (no secrets, read-only).
  useEffect(() => {
    (window as unknown as { __jarvis?: unknown }).__jarvis = {
      captureLive: () => controllerRef.current?.captureLive() ?? false,
      listening: () => controllerRef.current?.active ?? false,
      speaking: () => playerRef.current?.speaking ?? false,
      /** "speaking" only once audio is actually playing (not while loading). */
      playerState: () => playerRef.current?.playerState ?? "idle",
    };
  }, []);

  const phase = derivePhase({ capture, commandCapture, transcribing, busy, player });

  return {
    phase,
    capture,
    captureDetail,
    level,
    wakeEngine,
    transcriber,
    segments,
    interim,
    turns,
    conversationId,
    proposals,
    notice,
    systemAudio,
    lastWakeAt,
    player,
    actions: useMemo(
      () => ({
        enableListening,
        stopListening,
        ask,
        interrupt,
        pauseSpeech: () => playerRef.current?.pause(),
        resumeSpeech: () => playerRef.current?.resume(),
        replay: (text: string) => {
          const s = settingsRef.current;
          void playerRef.current?.speak(text, { engine: s.voiceEngine, voice: s.voiceName, rate: s.speechRate, lang: s.language });
        },
        newConversation: () => {
          conversationRef.current = undefined;
          setConversationId(undefined);
          setTurns([]);
        },
        loadConversation: (id: string, loaded: Turn[]) => {
          conversationRef.current = id;
          setConversationId(id);
          setTurns(loaded);
        },
        appendTurn: (t: Turn) => setTurns((ts) => [...ts, t]),
        clearTranscript: () => {
          segmentsRef.current = [];
          setSegments([]);
        },
        addTypedSegment: (text: string, source: TranscriptSegment["source"]) => addSegment(text, source),
        dismissProposal: (id: string) => setProposals((p) => p.filter((x) => x.id !== id)),
        resolveConfirmation: (turnId: string, resolved: "approved" | "cancelled", summary?: string) =>
          updateTurn(turnId, (t) => ({ ...t, confirmation: t.confirmation ? { ...t.confirmation, resolved } : undefined, toolResult: summary ? { tool: t.confirmation?.tool ?? "", summary } : t.toolResult })),
        startSystemAudio: async () => {
          try {
            await controllerRef.current?.startSystemAudio(settingsRef.current.language);
          } catch (e) {
            flash((e as Error).message);
          }
        },
        stopSystemAudio: () => controllerRef.current?.stopSystemAudio(),
        flash,
      }),
      [enableListening, stopListening, ask, interrupt, addSegment, updateTurn, flash],
    ),
  };
}

/** A short, quiet two-tone chime acknowledging the wake word. */
function earcon() {
  try {
    const ctx = new AudioContext();
    const g = ctx.createGain();
    g.gain.value = 0.05;
    g.connect(ctx.destination);
    [880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      o.connect(g);
      o.start(ctx.currentTime + i * 0.09);
      o.stop(ctx.currentTime + i * 0.09 + 0.08);
    });
    setTimeout(() => void ctx.close(), 400);
  } catch {
    /* audio not available */
  }
}
