"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import type { MemoryProposal } from "@/lib/shared/events";
import { LearnedPanel } from "./LearnedPanel";
import { Badge, Button, inputCls } from "./ui";

interface Memory {
  id: string;
  kind: string;
  content: string;
  status: string;
  source: string;
  confidence: number;
  updatedAt: string;
}

const KINDS = ["fact", "preference", "project", "inference"];

export function MemoryPanel({ enabled, reflection, proposals, onProposalHandled, refreshKey }: { enabled: boolean; reflection: boolean; proposals: MemoryProposal[]; onProposalHandled: (id: string) => void; refreshKey: number }) {
  const [items, setItems] = useState<Memory[]>([]);
  const [draft, setDraft] = useState("");
  const [kind, setKind] = useState("fact");
  const [editing, setEditing] = useState<{ id: string; content: string } | null>(null);
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(
    () =>
      api<{ memories: Memory[] }>(`/api/memories${q ? `?q=${encodeURIComponent(q)}` : ""}`).then(
        (r) => setItems(r.memories),
        (e) => setErr(e instanceof ApiError ? e.message : "Couldn't load memories."),
      ),
    [q],
  );

  useEffect(() => {
    let live = true;
    api<{ memories: Memory[] }>(`/api/memories${q ? `?q=${encodeURIComponent(q)}` : ""}`).then(
      (r) => live && setItems(r.memories),
      (e) => live && setErr(e instanceof ApiError ? e.message : "Couldn't load memories."),
    );
    return () => {
      live = false;
    };
  }, [q, refreshKey, proposals.length]);

  const act = async (fn: () => Promise<unknown>) => {
    setErr("");
    try {
      await fn();
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "That didn't work.");
    }
  };

  const pending = items.filter((m) => m.status === "proposed");
  const approved = items.filter((m) => m.status === "approved");

  return (
    <div className="space-y-4" data-testid="memory-panel">
      {!enabled && <p className="rounded-xl border border-warn/30 bg-warn/5 p-2 text-xs text-warn">Memory is off. JARVIS won&apos;t store or use memories. Turn it on in Settings → Privacy.</p>}
      <LearnedPanel refreshKey={refreshKey} enabled={enabled && reflection} />
      <p className="text-xs text-muted">
        Facts you tell me are saved automatically when auto-learning is on (Settings → Privacy); suggestions I&apos;m unsure about wait for your approval. Edit or delete anything below.
      </p>

      {pending.length > 0 && (
        <div className="space-y-2">
          <p className="hud-label">Suggested — approve?</p>
          {pending.map((m) => (
            <div key={m.id} className="rounded-xl border border-accent/30 bg-accent-soft p-2.5 text-sm">
              <p className="text-fg">
                <Badge className="mr-1">{m.kind}</Badge>
                {m.content}
              </p>
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="primary" onClick={() => void act(async () => (await api(`/api/memories/${m.id}`, { method: "PATCH", json: { status: "approved" } }), onProposalHandled(m.id)))}>
                  Remember
                </Button>
                <Button size="sm" onClick={() => void act(async () => (await api(`/api/memories/${m.id}`, { method: "DELETE" }), onProposalHandled(m.id)))}>
                  Discard
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim().length < 2) return;
          void act(async () => {
            await api("/api/memories", { method: "POST", json: { kind, content: draft.trim() } });
            setDraft("");
          });
        }}
      >
        <select className={`${inputCls} sm:w-32`} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Memory type" disabled={!enabled}>
          {KINDS.map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <input className={inputCls} placeholder="Add something to remember…" value={draft} onChange={(e) => setDraft(e.target.value)} disabled={!enabled} aria-label="New memory" />
        <Button type="submit" variant="primary" disabled={!enabled || draft.trim().length < 2}>
          Add
        </Button>
      </form>

      <input className={inputCls} placeholder="Search memories…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search memories" />
      {err && <p className="text-xs text-bad">{err}</p>}

      <ul className="space-y-1.5">
        {approved.length === 0 && <li className="text-sm text-faint">No memories yet. Say “Hey JARVIS, remember that…” or add one above.</li>}
        {approved.map((m) => (
          <li key={m.id} className="group rounded-xl border border-line bg-black/20 p-2.5 text-sm">
            {editing?.id === m.id ? (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(async () => {
                    await api(`/api/memories/${m.id}`, { method: "PATCH", json: { content: editing.content } });
                    setEditing(null);
                  });
                }}
              >
                <input className={inputCls} value={editing.content} onChange={(e) => setEditing({ id: m.id, content: e.target.value })} aria-label="Edit memory" autoFocus />
                <Button type="submit" size="sm" variant="primary">
                  Save
                </Button>
              </form>
            ) : (
              <div className="flex items-start gap-2">
                <Badge tone={m.kind === "inference" ? "warn" : m.kind === "preference" ? "accent" : "neutral"} className="mt-0.5 shrink-0">
                  {m.kind}
                </Badge>
                <span className="flex-1 text-fg/90">{m.content}</span>
                <Button size="sm" variant="ghost" onClick={() => setEditing({ id: m.id, content: m.content })} aria-label="Edit memory">
                  ✎
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void act(() => api(`/api/memories/${m.id}`, { method: "DELETE" }))} aria-label="Delete memory">
                  ✕
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-2 border-t border-line pt-3">
        <a className="inline-flex items-center rounded-xl border border-line-strong px-2.5 py-1 text-xs text-fg hover:bg-accent-soft" href="/api/memories/export" download>
          Export memories
        </a>
        <Button
          size="sm"
          variant="ghost"
          className="!text-bad"
          onClick={() => {
            if (window.confirm("Delete ALL memories permanently?")) void act(() => api("/api/memories", { method: "DELETE", json: { ids: "all" } }));
          }}
        >
          Delete all memories
        </Button>
      </div>
    </div>
  );
}
