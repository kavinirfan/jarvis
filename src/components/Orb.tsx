"use client";

import { useEffect, useRef } from "react";
import type { Phase } from "@/lib/client/useJarvis";

const PHASE_COLOR: Record<Phase, [number, number, number]> = {
  off: [70, 90, 130],
  starting: [63, 169, 255],
  listening: [63, 169, 255],
  standby: [60, 110, 180],
  capturing: [102, 224, 255],
  transcribing: [102, 224, 255],
  thinking: [140, 150, 255],
  researching: [120, 200, 255],
  speaking: [80, 230, 255],
  error: [255, 107, 122],
};

/**
 * Central voice visualization: concentric HUD rings (CSS) around a canvas waveform orb that
 * reacts to the live microphone level and JARVIS's state. Static when reduced motion is on.
 */
export function Orb({ phase, level, size = 260 }: { phase: Phase; level: number; size?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const levelRef = useRef(level);
  const phaseRef = useRef(phase);
  useEffect(() => {
    levelRef.current = level;
    phaseRef.current = phase;
  }, [level, phase]);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = size * dpr;
    c.height = size * dpr;
    ctx.scale(dpr, dpr);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let smooth = 0;
    let t = 0;
    const draw = () => {
      const p = phaseRef.current;
      const [r, g, b] = PHASE_COLOR[p];
      const active = p !== "off" && p !== "standby";
      const synthetic = p === "speaking" ? 0.35 + 0.25 * Math.sin(t * 9) * Math.sin(t * 3.3) : p === "thinking" || p === "researching" ? 0.18 : 0;
      const target = Math.min(1, Math.max(levelRef.current * 9, synthetic));
      smooth += (target - smooth) * 0.18;
      t += reduce ? 0 : 0.016;
      const cx = size / 2;
      const cy = size / 2;
      const base = size * 0.24;
      ctx.clearRect(0, 0, size, size);

      // glow
      const glow = ctx.createRadialGradient(cx, cy, base * 0.2, cx, cy, base * 1.9);
      glow.addColorStop(0, `rgba(${r},${g},${b},${active ? 0.35 + smooth * 0.3 : 0.12})`);
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, base * 1.9, 0, Math.PI * 2);
      ctx.fill();

      // waveform rings
      for (let ring = 0; ring < 3; ring++) {
        ctx.beginPath();
        const amp = (active ? 4 + smooth * 26 : 2) * (1 - ring * 0.25);
        for (let a = 0; a <= Math.PI * 2 + 0.01; a += Math.PI / 90) {
          const wobble =
            Math.sin(a * (5 + ring) + t * (2.2 + ring)) * amp * 0.55 + Math.sin(a * (9 - ring) - t * (3.1 + ring * 0.7)) * amp * 0.45;
          const rr = base + ring * 7 + wobble;
          const x = cx + Math.cos(a) * rr;
          const y = cy + Math.sin(a) * rr;
          if (a === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = `rgba(${r},${g},${b},${0.75 - ring * 0.22})`;
        ctx.lineWidth = ring === 0 ? 2 : 1;
        ctx.shadowColor = `rgba(${r},${g},${b},0.8)`;
        ctx.shadowBlur = ring === 0 ? 14 : 0;
        ctx.stroke();
      }
      ctx.shadowBlur = 0;

      // core
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, base * 0.8);
      core.addColorStop(0, `rgba(${Math.min(255, r + 120)},${Math.min(255, g + 60)},255,${active ? 0.55 : 0.2})`);
      core.addColorStop(0.6, `rgba(${r},${g},${b},${active ? 0.18 : 0.06})`);
      core.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(cx, cy, base * 0.8, 0, Math.PI * 2);
      ctx.fill();

      if (!reduce || p !== phaseRef.current) raf = requestAnimationFrame(draw);
    };
    draw();
    if (reduce) {
      const id = window.setInterval(draw, 250); // still reflect state changes, without motion
      return () => window.clearInterval(id);
    }
    return () => cancelAnimationFrame(raf);
  }, [size]);

  const busy = phase === "thinking" || phase === "researching";
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }} aria-hidden>
      <div className={`absolute inset-[4%] rounded-full border border-dashed border-accent/25 ${busy ? "animate-orb-spin" : ""}`} style={busy ? { animationDuration: "4s" } : undefined} />
      <div className="animate-orb-spin absolute inset-[9%] rounded-full border border-accent/15 [border-top-color:rgba(102,224,255,0.6)]" />
      <div className="animate-orb-spin-rev absolute inset-[15%] rounded-full border border-accent/10 [border-bottom-color:rgba(63,169,255,0.5)]" />
      <canvas ref={canvas} style={{ width: size, height: size }} className="relative" />
    </div>
  );
}
