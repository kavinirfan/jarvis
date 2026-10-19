"use client";

import { useEffect, useRef } from "react";
import type { ResearchStep, Turn } from "@/lib/client/useJarvis";
import type { PublicSourceDto, TranscriptSegment } from "@/lib/shared/events";
import { Badge } from "./ui";

export function SourcesList({ sources, steps, mockNotice }: { sources: PublicSourceDto[]; steps: ResearchStep[]; mockNotice?: boolean }) {
  const STAGES: Record<string, string> = { searching: "Searched", reading: "Read", synthesizing: "Cross-checked sources", routing: "Classified question", answering: "Answered from model knowledge", tool: "Used tool" };
  return (
    <div className="space-y-4">
      {steps.length > 0 && (
        <ol className="space-y-1 border-l border-line pl-3 text-xs text-muted">
          {steps.map((s, i) => (
            <li key={i} className="relative">
              <span className="absolute -left-[0.95rem] top-1.5 h-1.5 w-1.5 rounded-full bg-accent/70" />
              {STAGES[s.stage] ?? s.stage}
              {s.detail && <span className="text-faint">: {s.detail}</span>}
            </li>
          ))}
        </ol>
      )}
      {sources.length === 0 ? (
        <p className="text-sm text-faint">Sources appear here when JARVIS researches a question. Direct answers come from the model&apos;s own knowledge and have no citations.</p>
      ) : (
        <ol className="space-y-2.5" data-testid="sources">
          {mockNotice && <p className="text-xs text-warn">These are mock placeholder sources, not real web results.</p>}
          {sources.map((s) => (
            <li key={s.n} className="rounded-xl border border-line bg-black/20 p-3">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 font-mono text-xs text-accent">[{s.n}]</span>
                <div className="min-w-0 flex-1">
                  <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="line-clamp-2 text-sm font-medium text-fg hover:text-accent hover:underline">
                    {s.title}
                  </a>
                  <p className="mt-0.5 truncate font-mono text-[0.65rem] text-faint">
                    {s.domain}
                    {s.publishedAt ? ` · ${s.publishedAt.slice(0, 10)}` : ""} · via {s.provider}
                  </p>
                  {s.snippet && <p className="mt-1 line-clamp-3 text-xs text-muted">{s.snippet}</p>}
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <Badge tone={s.credibility === "high" ? "good" : s.credibility === "low" ? "bad" : "neutral"}>
                      <span title={s.credibilityReason}>{s.credibility} credibility</span>
                    </Badge>
                    <Badge tone={s.access === "read" ? "accent" : "warn"}>{s.access === "read" ? "page read" : "snippet only"}</Badge>
                    {s.mock && <Badge tone="warn">mock</Badge>}
                  </div>
                  {s.accessNote && <p className="mt-1 text-[0.7rem] text-warn/80">{s.accessNote}</p>}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function TranscriptView({ segments, interim, mode, capture }: { segments: TranscriptSegment[]; interim: string; mode: string; capture: string }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [segments.length, interim]);
  return (
    <div className="space-y-1.5 text-sm" aria-live="polite" data-testid="transcript">
      {segments.length === 0 && !interim && (
        <p className="text-faint">
          {capture === "off"
            ? "Nothing yet. Press Enable Listening, or type below."
            : mode === "wake"
              ? "Wake mode: audio is analysed on this device. Only what you say after “Hey JARVIS” is transcribed."
              : "Listening. Speech will appear here."}
        </p>
      )}
      {segments.map((s, i) => (
        <p key={i} className="flex gap-2">
          <span className="shrink-0 font-mono text-[0.65rem] leading-5 text-faint">{s.at.slice(11, 19)}</span>
          {s.source === "system" && <Badge className="shrink-0">system</Badge>}
          <span className="text-fg/85">{s.text}</span>
        </p>
      ))}
      {interim && <p className="pl-14 italic text-muted">{interim}…</p>}
      <div ref={end} />
    </div>
  );
}

export function latestResearch(turns: Turn[]) {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].sources.length || turns[i].steps.length) return turns[i];
  }
  return null;
}
