"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import type { Turn } from "@/lib/client/useJarvis";
import type { FinalAnswer } from "@/lib/shared/events";
import { Button, inputCls } from "./ui";

interface Conv {
  id: string;
  title: string;
  updatedAt: string;
}
interface Msg {
  id: string;
  role: string;
  content: string;
  createdAt: string;
  meta: Record<string, unknown>;
}

/** Rebuilds displayable turns from stored messages. */
function toTurns(messages: Msg[]): Turn[] {
  const turns: Turn[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      turns.push({ id: m.id, question: m.content, trigger: String(m.meta.trigger ?? "typed"), status: "done", text: "", answer: null, sources: [], steps: [], warnings: [] });
    } else if (m.role === "assistant" && turns.length) {
      const t = turns[turns.length - 1];
      const answer = { ...(m.meta as unknown as FinalAnswer), text: m.content };
      t.text = m.content;
      t.answer = answer;
      t.sources = answer.sources ?? [];
      t.messageId = m.id;
      t.latencyMs = m.meta.latencyMs as number | undefined;
    }
  }
  return turns;
}

export function HistoryPanel({ currentId, onLoad, onNew, refreshKey }: { currentId?: string; onLoad: (id: string, turns: Turn[]) => void; onNew: () => void; refreshKey: number }) {
  const [convs, setConvs] = useState<Conv[]>([]);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ conversationId: string; content: string; role: string }[]>([]);
  const [err, setErr] = useState("");

  const load = useCallback(async (query: string) => {
    try {
      const r = await api<{ conversations: Conv[]; hits?: typeof hits }>(`/api/conversations${query ? `?q=${encodeURIComponent(query)}` : ""}`);
      setConvs(r.conversations);
      setHits(r.hits ?? []);
      setErr("");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Couldn't load history.");
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(q.trim()), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [q, load, refreshKey]);

  const open = async (id: string) => {
    try {
      const r = await api<{ messages: Msg[] }>(`/api/conversations/${id}`);
      onLoad(id, toTurns(r.messages));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Couldn't open that conversation.");
    }
  };

  const remove = async (id: string) => {
    await api(`/api/conversations/${id}`, { method: "DELETE" }).catch(() => {});
    if (id === currentId) onNew();
    void load(q.trim());
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input className={inputCls} placeholder="Search all history…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search history" />
        <Button size="sm" onClick={onNew}>
          New
        </Button>
      </div>
      {err && <p className="text-xs text-bad">{err}</p>}
      {q && hits.length > 0 && (
        <ul className="space-y-1">
          {hits.slice(0, 8).map((h, i) => (
            <li key={i}>
              <button className="w-full rounded-lg px-2 py-1 text-left text-xs text-muted hover:bg-white/5" onClick={() => void open(h.conversationId)}>
                <span className="text-accent">{h.role === "user" ? "You" : "JARVIS"}:</span> {h.content}
              </button>
            </li>
          ))}
        </ul>
      )}
      <ul className="space-y-1">
        {convs.length === 0 && <li className="text-sm text-faint">{q ? "No matches." : "No conversations yet."}</li>}
        {convs.map((c) => (
          <li key={c.id} className={`group flex items-center gap-1 rounded-lg ${c.id === currentId ? "bg-accent-soft" : "hover:bg-white/5"}`}>
            <button className="min-w-0 flex-1 px-2 py-1.5 text-left" onClick={() => void open(c.id)}>
              <span className="block truncate text-sm text-fg">{c.title}</span>
              <span className="font-mono text-[0.65rem] text-faint">{new Date(c.updatedAt).toLocaleString()}</span>
            </button>
            <Button size="sm" variant="ghost" className="opacity-60 group-hover:opacity-100" aria-label={`Delete conversation ${c.title}`} onClick={() => void remove(c.id)}>
              ✕
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
