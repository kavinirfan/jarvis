"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { Badge, Button } from "./ui";

export interface StatusInfo {
  services: { ai: string; models: { fast: string; balanced: string } | null; search: string[]; stt: string[]; tts: string[]; wakeWord: string; database: string };
  issues: { service: string; level: "error" | "warning" | "info"; message: string }[];
  usage: { byKind: Record<string, number>; billable: number; budget: number };
  failures: { kind: string; provider: string; detail: Record<string, unknown>; at: string }[];
  config: string;
  admin: boolean;
}

interface ConfigRow {
  version: string;
  status: string;
  notes: string;
  activatedAt: string | null;
}

export function useStatus(refreshKey: number) {
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(
    () =>
      api<StatusInfo>("/api/status").then(
        (s) => {
          setStatus(s);
          setError("");
        },
        (e) => setError(e instanceof ApiError ? e.message : "Server unreachable"),
      ),
    [],
  );
  useEffect(() => {
    const t = window.setTimeout(load, 0);
    const id = window.setInterval(load, 60_000);
    return () => {
      window.clearTimeout(t);
      window.clearInterval(id);
    };
  }, [load, refreshKey]);
  return { status, error, reload: load };
}

export function StatusPanel({ status, error, wakeEngine, transcriber }: { status: StatusInfo | null; error: string; wakeEngine: string; transcriber: { status: string; detail?: string } }) {
  const [configs, setConfigs] = useState<ConfigRow[]>([]);
  const [runs, setRuns] = useState<{ configVersion: string; scores: Record<string, number>; createdAt: string }[]>([]);
  const [msg, setMsg] = useState("");

  const loadConfigs = useCallback(
    () =>
      api<{ configs: ConfigRow[]; evalRuns: typeof runs }>("/api/configs").then(
        (r) => {
          setConfigs(r.configs);
          setRuns(r.evalRuns);
        },
        () => {}, // non-critical
      ),
    [],
  );
  useEffect(() => {
    const t = window.setTimeout(loadConfigs, 0);
    return () => window.clearTimeout(t);
  }, [loadConfigs]);

  if (error) return <p className="text-sm text-bad">{error}</p>;
  if (!status) return <p className="text-sm text-faint">Loading…</p>;
  const pct = Math.min(100, Math.round((status.usage.billable / status.usage.budget) * 100));

  return (
    <div className="space-y-4 text-sm">
      {status.issues.length > 0 && (
        <ul className="space-y-1.5">
          {status.issues.map((i, k) => (
            <li key={k} className={`rounded-xl border p-2 text-xs ${i.level === "error" ? "border-bad/40 bg-bad/5 text-bad" : i.level === "warning" ? "border-warn/40 bg-warn/5 text-warn" : "border-line text-muted"}`}>
              {i.message}
            </li>
          ))}
        </ul>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-muted">AI</dt>
        <dd>{status.services.ai === "mock" ? <Badge tone="warn">mock</Badge> : `${status.services.models?.fast} / ${status.services.models?.balanced}`}</dd>
        <dt className="text-muted">Search</dt>
        <dd>{status.services.search.join(" → ")}</dd>
        <dt className="text-muted">Speech in</dt>
        <dd>
          {status.services.stt.join(", ")} {transcriber.status !== "idle" && <Badge tone={transcriber.status === "live" ? "good" : transcriber.status === "error" ? "bad" : "warn"}>{transcriber.status}</Badge>}
        </dd>
        <dt className="text-muted">Voice</dt>
        <dd>{status.services.tts.join(", ")}</dd>
        <dt className="text-muted">Wake word</dt>
        <dd>
          {status.services.wakeWord} {wakeEngine !== "idle" && <Badge tone={wakeEngine === "ready" ? "good" : wakeEngine === "unavailable" ? "bad" : "warn"}>{wakeEngine}</Badge>}
        </dd>
        <dt className="text-muted">Database</dt>
        <dd>{status.services.database}</dd>
        <dt className="text-muted">Prompt config</dt>
        <dd className="font-mono">{status.config}</dd>
      </dl>

      <div>
        <p className="hud-label mb-1">Today&apos;s usage</p>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/5" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Daily budget used">
          <div className={`h-full ${pct > 80 ? "bg-warn" : "bg-accent"}`} style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1 text-xs text-muted">
          {status.usage.billable} of {status.usage.budget} requests · {Object.entries(status.usage.byKind).map(([k, v]) => `${k} ${v}`).join(" · ") || "none yet"}
          {pct > 80 && " · economy routing active (fast model only)"}
        </p>
      </div>

      {status.failures.length > 0 && (
        <div>
          <p className="hud-label mb-1">Recent failures</p>
          <ul className="space-y-0.5 text-xs text-muted">
            {status.failures.map((f, i) => (
              <li key={i}>
                <span className="font-mono text-faint">{new Date(f.at).toLocaleTimeString()}</span> {f.kind} · {f.provider} · {String(f.detail.message ?? f.detail.code ?? "")}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="hud-label mb-1">Configurations</p>
        <ul className="space-y-1 text-xs">
          {configs.map((c) => (
            <li key={c.version} className="flex items-center gap-2">
              <span className="font-mono">{c.version}</span>
              <Badge tone={c.status === "active" ? "good" : "neutral"}>{c.status}</Badge>
              <span className="truncate text-faint">{c.notes}</span>
              {status.admin && c.status !== "active" && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  onClick={async () => {
                    try {
                      await api("/api/configs", { method: "POST", json: { action: "activate", version: c.version } });
                      setMsg(`Activated ${c.version}.`);
                      void loadConfigs();
                    } catch (e) {
                      setMsg(e instanceof ApiError ? e.message : "Failed");
                    }
                  }}
                >
                  Activate
                </Button>
              )}
            </li>
          ))}
        </ul>
        {status.admin && configs.some((c) => c.status === "retired") && (
          <Button
            size="sm"
            className="mt-2"
            onClick={async () => {
              try {
                const r = await api<{ active: string }>("/api/configs", { method: "POST", json: { action: "rollback" } });
                setMsg(`Rolled back to ${r.active}.`);
                void loadConfigs();
              } catch (e) {
                setMsg(e instanceof ApiError ? e.message : "Failed");
              }
            }}
          >
            Roll back to previous
          </Button>
        )}
        {runs.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-xs text-muted">
            {runs.slice(0, 5).map((r, i) => (
              <li key={i}>
                eval {r.configVersion}: {Object.entries(r.scores).map(([k, v]) => `${k} ${typeof v === "number" ? v.toFixed(2) : v}`).join(", ")}
              </li>
            ))}
          </ul>
        )}
        {msg && <p className="mt-1 text-xs text-accent">{msg}</p>}
      </div>
    </div>
  );
}
