"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Panel({ title, right, children, className = "", bodyClassName = "", id }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string; id?: string }) {
  return (
    <section id={id} className={`glass flex min-h-0 flex-col rounded-2xl ${className}`} aria-label={typeof title === "string" ? title : undefined}>
      {(title || right) && (
        <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <h2 className="hud-label">{title}</h2>
          {right}
        </header>
      )}
      <div className={`min-h-0 flex-1 p-4 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

type Variant = "primary" | "danger" | "ghost" | "outline";
const VARIANT: Record<Variant, string> = {
  primary: "bg-accent text-[#021022] hover:bg-accent-2 shadow-[0_0_24px_-6px_rgba(63,169,255,0.7)]",
  danger: "bg-bad text-[#22030a] hover:brightness-110 shadow-[0_0_24px_-6px_rgba(255,107,122,0.7)]",
  ghost: "text-muted hover:text-fg hover:bg-white/5",
  outline: "border border-line-strong text-fg hover:bg-accent-soft",
};

export function Button({ variant = "outline", size = "md", className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg" }) {
  const sz = size === "lg" ? "px-5 py-3 text-sm" : size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm";
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${sz} ${VARIANT[variant]} ${className}`}
    />
  );
}

export function Badge({ children, tone = "neutral", className = "" }: { children: ReactNode; tone?: "neutral" | "accent" | "good" | "warn" | "bad"; className?: string }) {
  const t = {
    neutral: "border-line text-muted",
    accent: "border-accent/40 text-accent bg-accent-soft",
    good: "border-good/40 text-good bg-good/10",
    warn: "border-warn/40 text-warn bg-warn/10",
    bad: "border-bad/40 text-bad bg-bad/10",
  }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[0.65rem] uppercase tracking-wider ${t} ${className}`}>{children}</span>;
}

export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={`flex items-start justify-between gap-4 py-2 ${disabled ? "opacity-50" : "cursor-pointer"}`}>
      <span>
        <span className="block text-sm text-fg">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors ${checked ? "border-accent bg-accent/70" : "border-line-strong bg-white/5"}`}
      >
        <span className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-all ${checked ? "left-[1.15rem]" : "left-0.5"}`} />
      </button>
    </label>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block py-2">
      <span className="block text-sm text-fg">{label}</span>
      {hint && <span className="mb-1 block text-xs text-muted">{hint}</span>}
      <div className="mt-1">{children}</div>
    </label>
  );
}

export const inputCls =
  "w-full rounded-xl border border-line-strong bg-black/30 px-3 py-2 text-sm text-fg placeholder:text-faint focus:border-accent focus:outline-none";

export function Dot({ tone }: { tone: "good" | "warn" | "bad" | "off" | "accent" }) {
  const c = { good: "bg-good", warn: "bg-warn", bad: "bg-bad", off: "bg-faint", accent: "bg-accent" }[tone];
  return <span className={`inline-block h-2 w-2 rounded-full ${c} ${tone !== "off" ? "animate-pulse-dot" : ""}`} aria-hidden />;
}
