"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { listAudioInputs } from "@/lib/client/audio/capture";
import { LANGUAGES } from "@/lib/shared/languages";
import { VOICE_OPTIONS, type Settings } from "@/lib/shared/settings";
import { Button, Field, inputCls, Toggle } from "./ui";

export function SettingsPanel({
  settings,
  onChange,
  deviceId,
  onDevice,
  onTestVoice,
  systemAudio,
  systemAudioSupported,
  onSystemAudio,
  listening,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  deviceId: string;
  onDevice: (id: string) => void;
  onTestVoice: () => void;
  systemAudio: boolean;
  systemAudioSupported: boolean;
  onSystemAudio: (on: boolean) => void;
  listening: boolean;
}) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [tab, setTab] = useState<"audio" | "voice" | "answers" | "privacy">("audio");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    void listAudioInputs().then(setDevices);
    const onChangeDevices = () => void listAudioInputs().then(setDevices);
    navigator.mediaDevices?.addEventListener?.("devicechange", onChangeDevices);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", onChangeDevices);
  }, [listening]);

  const tabs = [
    ["audio", "Audio input"],
    ["voice", "Voice"],
    ["answers", "Answers"],
    ["privacy", "Privacy"],
  ] as const;

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`rounded-lg px-2.5 py-1 text-xs ${tab === id ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "audio" && (
        <div className="divide-y divide-line">
          <Field label="Listening mode" hint={settings.listenMode === "wake" ? "Audio stays on this device until you say “Hey JARVIS”." : "Continuously transcribes nearby speech (sent to Gemini) and answers clear questions."}>
            <select className={inputCls} value={settings.listenMode} onChange={(e) => onChange({ listenMode: e.target.value as Settings["listenMode"] })}>
              <option value="wake">Wake word only — “Hey JARVIS” (private)</option>
              <option value="ambient">Ambient — understand nearby conversation</option>
            </select>
          </Field>
          <Field label="Microphone" hint={devices.some((d) => d.label) ? undefined : "Device names appear after you allow microphone access."}>
            <select className={inputCls} value={deviceId} onChange={(e) => onDevice(e.target.value)}>
              <option value="">System default</option>
              {devices.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `Microphone ${i + 1}`}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Speech recognition engine">
            <select className={inputCls} value={settings.sttEngine} onChange={(e) => onChange({ sttEngine: e.target.value as Settings["sttEngine"] })}>
              <option value="gemini">Gemini (accurate; streaming)</option>
              <option value="browser">Browser built-in (no key; Chrome sends audio to Google, Safari to Apple)</option>
            </select>
          </Field>
          <Field label="Spoken language">
            <select className={inputCls} value={settings.language} onChange={(e) => onChange({ language: e.target.value })}>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label={`Wake-word sensitivity (threshold ${settings.wakeThreshold.toFixed(2)})`} hint="Lower = triggers more easily (more false wakes). Higher = stricter.">
            <input type="range" min={0.2} max={0.95} step={0.05} value={settings.wakeThreshold} onChange={(e) => onChange({ wakeThreshold: Number(e.target.value) })} className="w-full accent-[var(--accent)]" aria-label="Wake-word threshold" />
          </Field>
          <Toggle checked={settings.strictWakeVerification} onChange={(v) => onChange({ strictWakeVerification: v })} label="Double-check the wake word" hint="Ignore commands whose transcript doesn't contain “Jarvis” (filters “Hey Travis”-type false wakes)." />
          <Field label={`Silence power-saving (${settings.silenceTimeoutSec}s)`} hint="Ambient mode pauses streaming after this much silence and resumes when speech returns.">
            <input type="range" min={5} max={300} step={5} value={settings.silenceTimeoutSec} onChange={(e) => onChange({ silenceTimeoutSec: Number(e.target.value) })} className="w-full accent-[var(--accent)]" aria-label="Silence timeout" />
          </Field>
          <div className="py-2">
            <p className="text-sm text-fg">Computer / tab audio</p>
            <p className="mb-2 text-xs text-muted">
              {systemAudioSupported
                ? "Share a browser tab (with “Share tab audio”) or your entire screen (with “Share system audio”, Chrome on Windows/ChromeOS, or macOS 14.2+ with Chrome 141+). Transcribed separately and labelled “system”."
                : "Not available in this browser. Use Chrome or Edge on a computer, or the native companion (see docs/NATIVE.md)."}
            </p>
            <Button size="sm" disabled={!systemAudioSupported} onClick={() => onSystemAudio(!systemAudio)}>
              {systemAudio ? "Stop sharing audio" : "Share tab / system audio"}
            </Button>
          </div>
        </div>
      )}

      {tab === "voice" && (
        <div className="divide-y divide-line">
          <Toggle checked={settings.voiceEnabled} onChange={(v) => onChange({ voiceEnabled: v })} label="Speak answers aloud" hint="Off = text only." />
          <Field label="Voice engine">
            <select className={inputCls} value={settings.voiceEngine} onChange={(e) => onChange({ voiceEngine: e.target.value as Settings["voiceEngine"] })}>
              <option value="gemini">Natural (Gemini voice, falls back to your Mac&apos;s voice)</option>
              <option value="browser">Built-in system voice (offline, free)</option>
            </select>
          </Field>
          {settings.voiceEngine === "gemini" && (
            <Field label="Voice">
              <select className={inputCls} value={settings.voiceName} onChange={(e) => onChange({ voiceName: e.target.value, voicePicked: true })}>
                {(["female", "male"] as const).map((g) => (
                  <optgroup key={g} label={g === "female" ? "Female voices" : "Male voices"}>
                    {VOICE_OPTIONS.filter((v) => v.gender === g).map((v) => (
                      <option key={v.name} value={v.name}>
                        {v.name} — {v.style}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </Field>
          )}
          <Field label={`Speaking speed (${settings.speechRate.toFixed(2)}×)`}>
            <input type="range" min={0.6} max={1.8} step={0.05} value={settings.speechRate} onChange={(e) => onChange({ speechRate: Number(e.target.value) })} className="w-full accent-[var(--accent)]" aria-label="Speaking speed" />
          </Field>
          <div className="py-2">
            <Button size="sm" onClick={onTestVoice}>
              ▶ Test voice
            </Button>
          </div>
        </div>
      )}

      {tab === "answers" && (
        <div className="divide-y divide-line">
          <Field label="Answer length">
            <select className={inputCls} value={settings.responseLength} onChange={(e) => onChange({ responseLength: e.target.value as Settings["responseLength"] })}>
              <option value="brief">Brief</option>
              <option value="normal">Normal</option>
              <option value="detailed">Detailed</option>
            </select>
          </Field>
          <Field label="Technical level">
            <select className={inputCls} value={settings.technicalLevel} onChange={(e) => onChange({ technicalLevel: e.target.value as Settings["technicalLevel"] })}>
              <option value="simple">Simple, plain language</option>
              <option value="intermediate">Intermediate</option>
              <option value="expert">Expert</option>
            </select>
          </Field>
          <Field label="Answer language">
            <select className={inputCls} value={settings.responseLanguage} onChange={(e) => onChange({ responseLanguage: e.target.value })}>
              <option value="auto">Same as the question</option>
              {LANGUAGES.filter((l) => l.code !== "auto").map((l) => (
                <option key={l.code} value={l.label}>
                  {l.label}
                </option>
              ))}
            </select>
          </Field>
          <Toggle checked={settings.autoResearch} onChange={(v) => onChange({ autoResearch: v })} label="Research on the web automatically" hint="When a question needs current or verifiable facts. Off = only when you press “Research this”." />
        </div>
      )}

      {tab === "privacy" && (
        <div className="divide-y divide-line">
          <Toggle checked={settings.memoryEnabled} onChange={(v) => onChange({ memoryEnabled: v })} label="Memory" hint="Let JARVIS remember you and recall past conversations." />
          <Toggle checked={settings.autoLearn} onChange={(v) => onChange({ autoLearn: v })} disabled={!settings.memoryEnabled} label="Auto-learn" hint="Save durable facts you mention automatically (you're told each time and can delete them). Off = ask first." />
          <Toggle checked={settings.selfReflection} onChange={(v) => onChange({ selfReflection: v })} disabled={!settings.memoryEnabled} label="Self-reflection" hint="Every few conversations, review feedback and history to improve how JARVIS helps you." />
          <Toggle checked={settings.deviceAccess} onChange={(v) => onChange({ deviceAccess: v })} label="Access this computer" hint="Let JARVIS use apps, files, screen, volume, reminders… (desktop app only; risky actions always ask first)." />
          <Toggle checked={settings.listenOnStartup} onChange={(v) => onChange({ listenOnStartup: v })} label="Listen when JARVIS starts" hint="Desktop app: start listening for “Hey JARVIS” at launch." />
          <Toggle checked={settings.saveTranscripts} onChange={(v) => onChange({ saveTranscripts: v })} label="Save nearby-speech transcripts with questions" hint="Off (default): only your questions and JARVIS's answers are stored. Transcripts stay in this tab's memory." />
          <Field label="Keep history for" hint="Older conversations are deleted automatically. 0 = keep forever.">
            <select className={inputCls} value={settings.historyRetentionDays} onChange={(e) => onChange({ historyRetentionDays: Number(e.target.value) })}>
              {[1, 7, 30, 90, 365, 0].map((d) => (
                <option key={d} value={d}>
                  {d === 0 ? "Forever" : `${d} day${d === 1 ? "" : "s"}`}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex flex-wrap gap-2 py-3">
            <a className="inline-flex items-center rounded-xl border border-line-strong px-2.5 py-1 text-xs text-fg hover:bg-accent-soft" href="/api/account" download>
              Export all my data
            </a>
            <Button
              size="sm"
              variant="ghost"
              className="!text-bad"
              onClick={async () => {
                if (!window.confirm("Delete all conversation history permanently?")) return;
                try {
                  const r = await api<{ deleted: number }>("/api/conversations", { method: "DELETE" });
                  setMsg(`Deleted ${r.deleted} conversations.`);
                } catch (e) {
                  setMsg(e instanceof ApiError ? e.message : "Failed.");
                }
              }}
            >
              Delete all history
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="!text-bad"
              onClick={async () => {
                const pw = window.prompt("This permanently deletes your account and all data. Enter your password to confirm:");
                if (!pw) return;
                try {
                  await api("/api/account", { method: "DELETE", json: { password: pw } });
                  window.location.replace("/login");
                } catch (e) {
                  setMsg(e instanceof ApiError ? e.message : "Failed.");
                }
              }}
            >
              Delete account
            </Button>
          </div>
          {msg && <p className="py-2 text-xs text-muted">{msg}</p>}
        </div>
      )}
    </div>
  );
}
