"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { micSupported, systemAudioSupported } from "@/lib/client/audio/capture";
import { useJarvis, type Phase } from "@/lib/client/useJarvis";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/shared/settings";
import { AnswerCard } from "./AnswerCard";
import { HistoryPanel } from "./HistoryPanel";
import { MemoryPanel } from "./MemoryPanel";
import { Orb } from "./Orb";
import { latestResearch, SourcesList, TranscriptView } from "./Panels";
import { SettingsPanel } from "./SettingsPanel";
import { StatusPanel, useStatus } from "./StatusPanel";
import { Badge, Button, Dot, inputCls, Panel } from "./ui";

const PHASE_TEXT: Record<Phase, string> = {
  off: "Standing by — listening is off",
  starting: "Starting microphone…",
  listening: "Listening",
  standby: "Listening (power-saving)",
  capturing: "Go ahead, I'm listening…",
  transcribing: "Transcribing…",
  thinking: "Thinking…",
  researching: "Researching…",
  speaking: "Speaking",
  error: "Attention needed",
};

type SideTab = "transcript" | "research" | "history" | "memory" | "settings" | "status";

export function Dashboard({ user }: { user: { email: string; displayName: string; admin: boolean } }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [deviceId, setDeviceId] = useState(() => {
    try {
      return localStorage.getItem("jarvis.deviceId") ?? "";
    } catch {
      return "";
    }
  });
  const [input, setInput] = useState("");
  const [tab, setTab] = useState<SideTab>("research");
  const [manualRefresh, setRefresh] = useState(0);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [uploading, setUploading] = useState<"" | "audio" | "doc">("");
  const j = useJarvis(settings);
  // Panels reload whenever an answer finishes (or after a manual change).
  const refresh = manualRefresh + j.turns.filter((t) => t.status !== "streaming").length;
  const { status, error: statusError } = useStatus(refresh);
  const feedEnd = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<number | null>(null);
  const pendingPatch = useRef<Partial<Settings>>({});

  useEffect(() => {
    api<{ settings: Settings }>("/api/settings")
      .then((r) => setSettings(r.settings))
      .catch(() => {})
      .finally(() => setSettingsLoaded(true));
    const on = () => setOnline(navigator.onLine);
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", on);
    };
  }, []);

  const changeSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...patch }));
    pendingPatch.current = { ...pendingPatch.current, ...patch };
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const p = pendingPatch.current;
      pendingPatch.current = {};
      api<{ settings: Settings }>("/api/settings", { method: "PUT", json: p }).catch(() => j.actions.flash("Couldn't save settings."));
    }, 500);
  }, [j.actions]);

  useEffect(() => {
    feedEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [j.turns.length]);

  const listening = j.capture !== "off" && j.capture !== "error";
  const research = latestResearch(j.turns);

  const submit = (force?: "research") => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    j.actions.addTypedSegment(text, "typed");
    void j.actions.ask(text, "typed", force);
  };

  const uploadAudio = async (file: File) => {
    setUploading("audio");
    try {
      const form = new FormData();
      form.append("audio", file);
      form.append("language", settings.language);
      const r = await api<{ text: string }>("/api/stt/transcribe", { method: "POST", body: form });
      if (!r.text.trim()) j.actions.flash("No speech found in that recording.");
      else {
        j.actions.addTypedSegment(r.text, "upload");
        void j.actions.ask(r.text, "upload");
      }
    } catch (e) {
      j.actions.flash(e instanceof ApiError ? e.message : "Couldn't transcribe that file.");
    } finally {
      setUploading("");
    }
  };

  const summarizeDoc = async (file: File) => {
    setUploading("doc");
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await api<{ summary: string; mock: boolean }>("/api/documents/summarize", { method: "POST", body: form });
      j.actions.appendTurn({
          id: `doc-${Date.now()}`,
          question: `Summarize document: ${file.name}`,
          trigger: "upload",
          status: "done",
          text: r.summary,
          answer: null,
          sources: [],
          steps: [],
          warnings: r.mock ? ["Mock output — no AI key configured."] : [],
      });
    } catch (e) {
      j.actions.flash(e instanceof ApiError ? e.message : "Couldn't summarize that document.");
    } finally {
      setUploading("");
    }
  };

  const sideTabs: [SideTab, string][] = [
    ["transcript", "Transcript"],
    ["research", "Research"],
    ["history", "History"],
    ["memory", "Memory"],
    ["settings", "Settings"],
    ["status", "Status"],
  ];

  const renderTab = (t: SideTab) => {
    switch (t) {
      case "transcript":
        return <TranscriptView segments={j.segments} interim={j.interim} mode={settings.listenMode} capture={j.capture} />;
      case "research":
        return <SourcesList sources={research?.sources ?? []} steps={research?.steps ?? []} mockNotice={research?.answer?.mock} />;
      case "history":
        return <HistoryPanel currentId={j.conversationId} onLoad={j.actions.loadConversation} onNew={j.actions.newConversation} refreshKey={refresh} />;
      case "memory":
        return <MemoryPanel enabled={settings.memoryEnabled} reflection={settings.selfReflection} proposals={j.proposals} onProposalHandled={j.actions.dismissProposal} refreshKey={refresh} />;
      case "settings":
        return (
          <SettingsPanel
            settings={settings}
            onChange={changeSettings}
            deviceId={deviceId}
            onDevice={(id) => {
              setDeviceId(id);
              try {
                localStorage.setItem("jarvis.deviceId", id);
              } catch {
                /* ignore */
              }
              if (listening) void j.actions.enableListening(id);
            }}
            onTestVoice={() => j.actions.replay("Good evening. All systems are online, and I'm ready when you are.")}
            systemAudio={j.systemAudio}
            systemAudioSupported={typeof window !== "undefined" && systemAudioSupported()}
            onSystemAudio={(on) => void (on ? j.actions.startSystemAudio() : j.actions.stopSystemAudio())}
            listening={listening}
          />
        );
      case "status":
        return <StatusPanel status={status} error={statusError} wakeEngine={j.wakeEngine} transcriber={j.transcriber} />;
    }
  };

  const aiTone = !status ? "off" : status.services.ai === "mock" ? "warn" : "good";

  return (
    <div className="mx-auto flex min-h-dvh max-w-[1600px] flex-col gap-3 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4">
      {/* Header: identity, connection and microphone status (always visible while capturing) */}
      <header className="glass sticky top-2 z-30 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl !bg-[rgba(7,12,26,0.92)] px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden>
            <circle cx="16" cy="16" r="13" fill="none" stroke="var(--accent)" strokeWidth="1.5" opacity=".5" />
            <circle cx="16" cy="16" r="8" fill="none" stroke="var(--accent-2)" strokeWidth="2" />
            <circle cx="16" cy="16" r="3" fill="var(--accent-2)" />
          </svg>
          <div className="leading-tight">
            <h1 className="font-mono text-sm font-semibold tracking-[0.3em] text-fg">J.A.R.V.I.S.</h1>
            <p className="text-[0.65rem] text-muted">Personal assistant</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
          <span className="flex items-center gap-1.5" title="Server connection">
            <Dot tone={online && !statusError ? "good" : "bad"} /> {online && !statusError ? "Online" : "Offline"}
          </span>
          <span className="flex items-center gap-1.5" title="AI provider">
            <Dot tone={aiTone} /> {status?.services.ai === "mock" ? "Mock AI" : "AI ready"}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {listening ? (
            <span className="flex items-center gap-1.5 rounded-full border border-bad/50 bg-bad/10 px-2.5 py-1 font-mono text-[0.65rem] uppercase tracking-wider text-bad" role="status" data-testid="mic-live">
              <span className="h-2 w-2 animate-pulse-dot rounded-full bg-bad" /> Mic live{j.systemAudio ? " + system audio" : ""}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 font-mono text-[0.65rem] uppercase tracking-wider text-faint" data-testid="mic-off">
              <span className="h-2 w-2 rounded-full bg-faint" /> Mic off
            </span>
          )}
          <span className="hidden text-xs text-muted md:inline">{user.displayName || user.email}</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              await j.actions.stopListening();
              await api("/api/auth/logout", { method: "POST" }).catch(() => {});
              window.location.replace("/login"); // full reload clears all in-memory state
            }}
          >
            Sign out
          </Button>
        </div>
      </header>

      {!online && <div className="rounded-xl border border-bad/40 bg-bad/10 p-2 text-center text-sm text-bad">You&apos;re offline. JARVIS needs a connection for answers; wake-word detection still runs locally.</div>}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[300px_minmax(0,1fr)_380px]">
        {/* Left column (wide screens) */}
        <div className="hidden min-h-0 flex-col gap-3 xl:flex">
          <Panel title="Live transcript" className="max-h-[48vh]" bodyClassName="overflow-y-auto scroll-thin" right={j.segments.length > 0 && <Button size="sm" variant="ghost" onClick={j.actions.clearTranscript}>Clear</Button>}>
            {renderTab("transcript")}
          </Panel>
          <Panel title="History" className="flex-1" bodyClassName="overflow-y-auto scroll-thin">
            {renderTab("history")}
          </Panel>
        </div>

        {/* Center: orb, controls, answers */}
        <main className="flex min-h-0 flex-col gap-3">
          <section className="glass relative flex flex-col items-center gap-3 overflow-hidden rounded-2xl px-4 pb-5 pt-4" aria-label="Voice control">
            <div className="flex w-full items-center justify-between text-xs">
              <span className="hud-label">Wake word · “Hey JARVIS”</span>
              <span className="flex items-center gap-2">
                {j.wakeEngine === "ready" && <Badge tone="good">on-device</Badge>}
                {j.wakeEngine === "loading" && <Badge tone="warn">loading model</Badge>}
                {j.wakeEngine === "unavailable" && <Badge tone="bad">unavailable</Badge>}
                <Badge tone="accent">{settings.listenMode === "wake" ? "wake mode" : "ambient mode"}</Badge>
              </span>
            </div>
            <Orb phase={j.phase} level={j.level} size={220} />
            <p className="-mt-2 text-center font-mono text-sm tracking-wide text-accent-2" role="status" aria-live="polite" data-testid="phase" data-phase={j.phase}>
              {PHASE_TEXT[j.phase]}
            </p>
            {(j.captureDetail || j.notice) && <p className={`max-w-xl text-center text-xs ${j.capture === "error" ? "text-bad" : "text-muted"}`} data-testid="notice">{j.capture === "error" ? j.captureDetail : j.notice || j.captureDetail}</p>}
            {j.transcriber.status === "error" && <p className="max-w-xl text-center text-xs text-bad">{j.transcriber.detail}</p>}

            <div className="flex flex-wrap items-center justify-center gap-2">
              {!listening ? (
                <Button variant="primary" size="lg" onClick={() => void j.actions.enableListening(deviceId)} disabled={!settingsLoaded || (typeof window !== "undefined" && !micSupported())} data-testid="enable-listening">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
                    <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2Z" />
                  </svg>
                  Enable Listening
                </Button>
              ) : (
                <Button variant="danger" size="lg" onClick={() => void j.actions.stopListening()} data-testid="stop-listening">
                  <span className="h-3 w-3 rounded-sm bg-current" aria-hidden />
                  Stop Listening
                </Button>
              )}
              {(j.player !== "idle" || j.phase === "thinking" || j.phase === "researching") && (
                <Button size="lg" onClick={j.actions.interrupt} data-testid="interrupt">
                  ■ Stop {j.player !== "idle" ? "speaking" : "answering"}
                </Button>
              )}
              {j.player === "speaking" && (
                <Button size="lg" variant="ghost" onClick={j.actions.pauseSpeech} aria-label="Pause speech">
                  ❚❚
                </Button>
              )}
              {j.player === "paused" && (
                <Button size="lg" variant="ghost" onClick={j.actions.resumeSpeech} aria-label="Resume speech">
                  ▶
                </Button>
              )}
            </div>
            {listening && j.interim && <p className="max-w-xl truncate text-center text-sm italic text-muted">“{j.interim}”</p>}
          </section>

          {/* Ask bar: text + uploads */}
          <form
            className="glass flex flex-col gap-2 rounded-2xl p-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <input className={`${inputCls} flex-1 !border-transparent !bg-transparent`} placeholder="Ask JARVIS anything, or say “Hey JARVIS”…" value={input} onChange={(e) => setInput(e.target.value)} aria-label="Ask JARVIS" data-testid="ask-input" />
            <div className="flex gap-1.5">
              <Button type="submit" variant="primary" disabled={!input.trim()} data-testid="ask-submit">
                Ask
              </Button>
              <Button disabled={!input.trim()} onClick={() => submit("research")} title="Search the web and cite sources">
                Research
              </Button>
              <label className={`inline-flex cursor-pointer items-center rounded-xl border border-line-strong px-3 py-2 text-sm text-fg hover:bg-accent-soft ${uploading ? "pointer-events-none opacity-50" : ""}`} title="Transcribe an audio recording and ask it">
                {uploading === "audio" ? "…" : "♪"}
                <span className="sr-only">Upload audio</span>
                <input type="file" accept="audio/*" className="sr-only" onChange={(e) => e.target.files?.[0] && void uploadAudio(e.target.files[0])} />
              </label>
              <label className={`inline-flex cursor-pointer items-center rounded-xl border border-line-strong px-3 py-2 text-sm text-fg hover:bg-accent-soft ${uploading ? "pointer-events-none opacity-50" : ""}`} title="Summarize a document (PDF, text, Markdown)">
                {uploading === "doc" ? "…" : "⎘"}
                <span className="sr-only">Summarize document</span>
                <input type="file" accept=".pdf,.txt,.md,text/plain,text/markdown,application/pdf" className="sr-only" onChange={(e) => e.target.files?.[0] && void summarizeDoc(e.target.files[0])} />
              </label>
            </div>
          </form>

          {j.proposals.length > 0 && (
            <div className="glass rounded-2xl border-accent/30 p-3 text-sm" role="status">
              <p className="hud-label mb-2">Remember this?</p>
              {j.proposals.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center gap-2 py-1">
                  <Badge>{p.kind}</Badge>
                  <span className="flex-1 text-fg">{p.content}</span>
                  <Button size="sm" variant="primary" onClick={() => void api(`/api/memories/${p.id}`, { method: "PATCH", json: { status: "approved" } }).then(() => (j.actions.dismissProposal(p.id), setRefresh((r) => r + 1)))}>
                    Remember
                  </Button>
                  <Button size="sm" onClick={() => void api(`/api/memories/${p.id}`, { method: "DELETE" }).then(() => j.actions.dismissProposal(p.id))}>
                    No
                  </Button>
                </div>
              ))}
            </div>
          )}

          <Panel title="Answers" className="min-h-[240px] flex-1" bodyClassName="overflow-y-auto scroll-thin space-y-3" right={j.turns.length > 0 && <Button size="sm" variant="ghost" onClick={j.actions.newConversation}>New conversation</Button>}>
            {j.turns.length === 0 ? (
              <div className="grid h-full place-items-center py-8 text-center text-sm text-muted">
                <div className="max-w-md space-y-2">
                  <p>Say <span className="text-accent-2">“Hey JARVIS, …”</span> after enabling listening, or type a question.</p>
                  <p className="text-xs text-faint">Try: “What&apos;s the difference between a virus and a bacterium?” · “Research the latest Mars mission news” · “Remember that I prefer short answers” · “Summarize the last five minutes”</p>
                </div>
              </div>
            ) : (
              j.turns.map((t, i) => (
                <AnswerCard key={t.id} turn={t} latest={i === j.turns.length - 1} onAsk={(q, force) => void j.actions.ask(q, "typed", force)} onReplay={j.actions.replay} onResolveConfirmation={j.actions.resolveConfirmation} />
              ))
            )}
            <div ref={feedEnd} />
          </Panel>
        </main>

        {/* Right column: tabs (all panels on smaller screens) */}
        <aside className="flex min-h-0 flex-col">
          <div className="glass flex min-h-[420px] flex-1 flex-col rounded-2xl lg:max-h-[calc(100dvh-6rem)]">
            <div className="scroll-thin flex gap-1 overflow-x-auto border-b border-line p-2" role="tablist" aria-label="Panels">
              {sideTabs.map(([id, label]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium ${tab === id ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"} ${id === "transcript" || id === "history" ? "xl:hidden" : ""}`}
                >
                  {label}
                  {id === "memory" && j.proposals.length > 0 && <span className="ml-1 rounded-full bg-accent px-1.5 text-[0.6rem] text-black">{j.proposals.length}</span>}
                  {id === "research" && research?.sources.length ? <span className="ml-1 text-faint">{research.sources.length}</span> : null}
                </button>
              ))}
            </div>
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4" role="tabpanel">
              {renderTab(tab)}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
