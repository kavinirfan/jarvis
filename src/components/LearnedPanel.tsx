"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { Button } from "./ui";

interface Insight {
  id: string;
  kind: string;
  content: string;
  generation: number;
  createdAt: string;
}

/** Shows what JARVIS has learned about working with the user; reflect on demand or reset. */
export function LearnedPanel({ refreshKey, enabled }: { refreshKey: number; enabled: boolean }) {
  const [items, setItems] = useState<Insight[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let live = true;
    api<{ insights: Insight[] }>("/api/insights").then(
      (r) => live && setItems(r.insights),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [refreshKey]);

  const profile = items.find((i) => i.kind === "profile");
  const behaviors = items.filter((i) => i.kind === "behavior");

  return (
    <div className="space-y-2 rounded-xl border border-accent/25 bg-accent-soft/40 p-3" data-testid="learned-panel">
      <div className="flex items-center justify-between gap-2">
        <p className="hud-label !text-accent">What I&apos;ve learned about you</p>
        {items[0] && <span className="font-mono text-[0.6rem] text-faint">generation {items[0].generation}</span>}
      </div>
      {!items.length && (
        <p className="text-xs text-muted">
          Nothing yet. I reflect every few conversations{enabled ? "" : " (turned off in Settings → Privacy)"} — on your feedback, what we talk about and what you&apos;ve told me — and write down how to help you better.
        </p>
      )}
      {profile && <p className="text-sm text-fg/90">{profile.content}</p>}
      {behaviors.length > 0 && (
        <ul className="space-y-1 text-sm">
          {behaviors.map((b) => (
            <li key={b.id} className="group flex items-start gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" />
              <span className="flex-1 text-fg/85">{b.content}</span>
              <button
                className="text-xs text-faint opacity-60 hover:text-bad group-hover:opacity-100"
                aria-label="Remove this learned behavior"
                onClick={async () => {
                  await api(`/api/insights?id=${b.id}`, { method: "DELETE" }).catch(() => {});
                  setItems((xs) => xs.filter((x) => x.id !== b.id));
                }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        <Button
          size="sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setMsg("");
            try {
              const r = await api<{ insights: Insight[]; result: { removedMemories: number } }>("/api/insights", { method: "POST" });
              setItems(r.insights);
              setMsg(r.result.removedMemories ? `Updated. Also tidied ${r.result.removedMemories} outdated memories.` : "Updated.");
            } catch (e) {
              setMsg(e instanceof ApiError ? e.message : "Reflection failed.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Reflecting…" : "Reflect now"}
        </Button>
        {items.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="!text-bad"
            onClick={async () => {
              if (!window.confirm("Reset everything JARVIS has learned about how to help you? (Memories are kept.)")) return;
              await api("/api/insights", { method: "DELETE" }).catch(() => {});
              setItems([]);
            }}
          >
            Reset
          </Button>
        )}
      </div>
      {msg && <p className="text-xs text-muted">{msg}</p>}
      <p className="text-[0.65rem] text-faint">This shapes my instructions and memory; it doesn&apos;t retrain the underlying AI model.</p>
    </div>
  );
}
