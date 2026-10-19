"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { Orb } from "./Orb";
import { Button, inputCls } from "./ui";

export function LoginForm() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [canRegister, setCanRegister] = useState(false);
  const [firstRun, setFirstRun] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ user: unknown; canRegister?: boolean; firstRun?: boolean }>("/api/auth/me")
      .then((r) => {
        if (r.user) window.location.replace("/");
        setCanRegister(!!r.canRegister);
        setFirstRun(!!r.firstRun);
        if (r.firstRun) setMode("register");
      })
      .catch(() => {});
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/api/auth/${mode}`, { method: "POST", json: mode === "login" ? { email, password } : { email, password, displayName: name } });
      window.location.replace("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <div className="glass w-full max-w-sm rounded-3xl p-6">
        <div className="mb-2 flex justify-center">
          <Orb phase="listening" level={0} size={150} />
        </div>
        <h1 className="text-center font-mono text-lg font-semibold tracking-[0.35em]">J.A.R.V.I.S.</h1>
        <p className="mb-6 text-center text-xs text-muted">{firstRun ? "Create the owner account for this JARVIS server." : mode === "login" ? "Sign in to your assistant." : "Create your account."}</p>
        <form onSubmit={submit} className="space-y-3">
          {mode === "register" && <input className={inputCls} placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" aria-label="Name" />}
          <input className={inputCls} type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" aria-label="Email" />
          <input
            className={inputCls}
            type="password"
            required
            minLength={mode === "register" ? 10 : undefined}
            placeholder={mode === "register" ? "Password (10+ characters)" : "Password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            aria-label="Password"
          />
          {error && (
            <p className="text-sm text-bad" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" className="w-full" disabled={busy}>
            {busy ? "…" : mode === "login" ? "Sign in" : "Create account"}
          </Button>
        </form>
        {canRegister && !firstRun && (
          <button className="mt-4 w-full text-center text-xs text-muted hover:text-fg" onClick={() => setMode(mode === "login" ? "register" : "login")}>
            {mode === "login" ? "New here? Create an account" : "Have an account? Sign in"}
          </button>
        )}
      </div>
    </main>
  );
}
