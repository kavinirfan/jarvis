"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import type { Turn } from "@/lib/client/useJarvis";
import { Markdown } from "./Markdown";
import { Badge, Button } from "./ui";

const STAGE_LABEL: Record<string, string> = {
  routing: "Understanding the question",
  answering: "Answering",
  searching: "Searching",
  reading: "Reading",
  synthesizing: "Cross-checking sources",
  tool: "Using tool",
};

const TRIGGER_LABEL: Record<string, string> = { wake: "Voice", ambient: "Overheard", typed: "Typed", upload: "Audio file" };

export function AnswerCard({
  turn,
  onAsk,
  onReplay,
  onResolveConfirmation,
  latest,
}: {
  turn: Turn;
  onAsk: (q: string, force?: "research") => void;
  onReplay: (text: string) => void;
  onResolveConfirmation: (turnId: string, resolved: "approved" | "cancelled", summary?: string) => void;
  latest: boolean;
}) {
  const a = turn.answer;
  const [rated, setRated] = useState<1 | -1 | null>(null);
  const [askWhy, setAskWhy] = useState(false);
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const rate = async (rating: 1 | -1, addToEval = false, comment = "") => {
    if (!turn.messageId) return;
    try {
      await api("/api/feedback", { method: "POST", json: { messageId: turn.messageId, rating, addToEval, comment } });
      setRated(rating);
      if (rating < 0 && !comment) setAskWhy(true);
      if (comment) setAskWhy(false);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Couldn't save feedback.");
    }
  };

  const resolve = async (approve: boolean) => {
    if (!turn.confirmation) return;
    setBusy(true);
    try {
      const r = await api<{ result: { summary: string; clientAction?: { type: string; url: string } } | null }>(`/api/actions/${turn.confirmation.actionId}`, { method: "POST", json: { approve } });
      if (r.result?.clientAction?.type === "open_url") window.open(r.result.clientAction.url, "_blank", "noopener,noreferrer");
      onResolveConfirmation(turn.id, approve ? "approved" : "cancelled", r.result?.summary);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Couldn't complete the action.");
    } finally {
      setBusy(false);
    }
  };

  const streaming = turn.status === "streaming";
  const lastStep = turn.steps[turn.steps.length - 1];

  return (
    <article className={`rounded-2xl border p-4 transition-colors ${latest ? "border-line-strong bg-white/[0.025]" : "border-line bg-transparent"}`} data-testid="answer-card">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <Badge>{TRIGGER_LABEL[turn.trigger] ?? turn.trigger}</Badge>
        {turn.route && <Badge tone="accent">{turn.route.action === "answer" ? "direct answer" : turn.route.action}</Badge>}
        {a?.mock && <Badge tone="warn">Mock output — not real AI</Badge>}
        {a && a.mode === "research" && <Badge tone={a.confidence === "high" ? "good" : a.confidence === "low" ? "bad" : "warn"}>confidence: {a.confidence}</Badge>}
        {turn.latencyMs !== undefined && <span className="ml-auto font-mono text-[0.65rem] text-faint">{(turn.latencyMs / 1000).toFixed(1)}s{a?.model && a.model !== "none" ? ` · ${a.model}` : ""}</span>}
      </header>

      <p className="mb-3 text-[0.95rem] font-medium text-fg">
        <span className="mr-2 font-mono text-xs text-accent">Q</span>
        {turn.question}
      </p>

      {streaming && !turn.text && (
        <div className="space-y-2" aria-live="polite">
          <p className="flex items-center gap-2 text-sm text-muted">
            <span className="inline-block h-1.5 w-1.5 animate-pulse-dot rounded-full bg-accent" />
            {lastStep ? `${STAGE_LABEL[lastStep.stage] ?? lastStep.stage}${lastStep.detail ? `: ${lastStep.detail}` : "…"}` : "Thinking…"}
          </p>
          <div className="shimmer h-2 w-2/3 rounded" />
        </div>
      )}

      {turn.status === "ignored" ? (
        <p className="text-sm text-faint">Ignored — {turn.text}</p>
      ) : (
        turn.text && (
          <div className="text-[0.92rem] text-fg/90" aria-live={latest ? "polite" : undefined}>
            <Markdown text={turn.text} sources={turn.sources} />
          </div>
        )
      )}

      {a && (a.established.length > 0 || a.disputed.length > 0 || a.uncertainty) && (
        <div className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
          {a.established.length > 0 && (
            <div className="rounded-xl border border-good/25 bg-good/5 p-3">
              <p className="hud-label mb-1 !text-good">Established</p>
              <ul className="space-y-1 text-fg/80">
                {a.established.map((c, i) => (
                  <li key={i}>
                    {c.claim} <span className="font-mono text-faint">[{c.sources.join(", ")}]</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {a.disputed.length > 0 && (
            <div className="rounded-xl border border-warn/25 bg-warn/5 p-3">
              <p className="hud-label mb-1 !text-warn">Disputed</p>
              <ul className="space-y-1 text-fg/80">
                {a.disputed.map((c, i) => (
                  <li key={i}>
                    {c.claim} {c.note && <span className="text-muted">— {c.note}</span>} <span className="font-mono text-faint">[{c.sources.join(", ")}]</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {a.uncertainty && (
            <div className="rounded-xl border border-line p-3 sm:col-span-2">
              <p className="hud-label mb-1">Uncertainty</p>
              <p className="text-fg/75">{a.uncertainty}</p>
            </div>
          )}
        </div>
      )}

      {turn.confirmation && (
        <div className="mt-4 rounded-xl border border-warn/40 bg-warn/5 p-3 text-sm" role="alert">
          <p className="mb-2 text-fg">
            <strong className="text-warn">Confirm action ({turn.confirmation.risk} risk):</strong> {turn.confirmation.summary}
          </p>
          {turn.confirmation.resolved ? (
            <p className="text-xs text-muted">{turn.confirmation.resolved === "approved" ? "Approved and done." : "Cancelled."}</p>
          ) : (
            <div className="flex gap-2">
              <Button variant="primary" size="sm" disabled={busy} onClick={() => void resolve(true)}>
                Approve
              </Button>
              <Button size="sm" disabled={busy} onClick={() => void resolve(false)}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      )}
      {turn.actions && turn.actions.length > 0 ? (
        <ul className="mt-3 space-y-0.5 text-xs text-good/90" aria-label="Actions taken">
          {turn.actions.map((x, i) => (
            <li key={i}>✓ {x.summary}</li>
          ))}
        </ul>
      ) : (
        turn.toolResult && !turn.text.includes(turn.toolResult.summary) && <p className="mt-3 text-sm text-good">{turn.toolResult.summary}</p>
      )}

      {turn.warnings.length > 0 && (
        <ul className="mt-3 space-y-0.5 text-xs text-warn/90">
          {turn.warnings.map((w, i) => (
            <li key={i}>⚠ {w}</li>
          ))}
        </ul>
      )}
      {(turn.error || err) && (
        <div className="mt-3 rounded-xl border border-bad/40 bg-bad/10 p-3 text-sm text-bad" role="alert">
          {turn.error || err}
          {turn.error && (
            <Button size="sm" variant="ghost" className="ml-2 !text-bad" onClick={() => onAsk(turn.question)}>
              Retry
            </Button>
          )}
        </div>
      )}

      {a && turn.status !== "streaming" && (
        <footer className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
          {a.followUps.map((f) => (
            <Button key={f} size="sm" variant="outline" onClick={() => onAsk(f)}>
              {f}
            </Button>
          ))}
          {a.mode === "direct" && (
            <Button size="sm" variant="ghost" onClick={() => onAsk(turn.question, "research")} title="Search the web and cite sources">
              Research this
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => onReplay(a.spoken || a.text)} aria-label="Speak answer again">
            ▶ Replay
          </Button>
          <span className="ml-auto flex items-center gap-1">
            <Button size="sm" variant="ghost" aria-label="Good answer" aria-pressed={rated === 1} className={rated === 1 ? "!text-good" : ""} onClick={() => void rate(1)} disabled={!turn.messageId}>
              ▲
            </Button>
            <Button size="sm" variant="ghost" aria-label="Bad answer" aria-pressed={rated === -1} className={rated === -1 ? "!text-bad" : ""} onClick={() => void rate(-1)} disabled={!turn.messageId}>
              ▼
            </Button>
            {rated !== null && (
              <Button size="sm" variant="ghost" onClick={() => void rate(rated, true)} title="Use this question in JARVIS's evaluation test set">
                + eval set
              </Button>
            )}
          </span>
          {askWhy && (
            <form
              className="mt-2 flex w-full gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (why.trim()) void rate(-1, false, why.trim());
              }}
            >
              <input className="flex-1 rounded-lg border border-line-strong bg-black/30 px-2 py-1 text-xs text-fg placeholder:text-faint" placeholder="What should I do differently? (I'll learn from it)" value={why} onChange={(e) => setWhy(e.target.value)} aria-label="Feedback comment" autoFocus />
              <Button type="submit" size="sm" disabled={!why.trim()}>
                Teach
              </Button>
            </form>
          )}
        </footer>
      )}
    </article>
  );
}
