"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import type { Settings } from "@/lib/settings/useSettings";

interface SettingsPanelProps {
  settings: Settings;
  onUpdate: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  onClose: () => void;
}

const IDLE_OPTIONS: { label: string; value: number }[] = [
  { label: "1 min",  value: 60_000 },
  { label: "3 min",  value: 3 * 60_000 },
  { label: "5 min",  value: 5 * 60_000 },
  { label: "10 min", value: 10 * 60_000 },
  { label: "Never",  value: 0 },
];

export function SettingsPanel({ settings, onUpdate, onClose }: SettingsPanelProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl space-y-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-white font-semibold text-lg">Ajustes</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* VAD threshold */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white text-sm font-medium">Sensibilidad del micrófono</p>
              <p className="text-gray-500 text-xs">Lower = picks up quieter speech</p>
            </div>
            <span className="text-gray-400 text-sm tabular-nums">
              {settings.vadThreshold.toFixed(1)}
            </span>
          </div>
          <input
            type="range"
            min={0.1}
            max={0.9}
            step={0.1}
            value={settings.vadThreshold}
            onChange={(e) => onUpdate("vadThreshold", parseFloat(e.target.value))}
            className="w-full accent-indigo-500"
          />
        </div>

        {/* VAD silence duration */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white text-sm font-medium">Pausa antes de responder</p>
              <p className="text-gray-500 text-xs">How long silence before the model speaks</p>
            </div>
            <span className="text-gray-400 text-sm tabular-nums">
              {settings.vadSilenceDurationMs}ms
            </span>
          </div>
          <input
            type="range"
            min={300}
            max={2000}
            step={100}
            value={settings.vadSilenceDurationMs}
            onChange={(e) => onUpdate("vadSilenceDurationMs", parseInt(e.target.value, 10))}
            className="w-full accent-indigo-500"
          />
        </div>

        {/* Server-side noise reduction */}
        <div className="space-y-2">
          <div>
            <p className="text-white text-sm font-medium">Reducción de ruido</p>
            <p className="text-gray-500 text-xs">Server-side filtering before speech detection</p>
          </div>
          <div className="flex gap-2">
            {(["near_field", "far_field", null] as const).map((v) => (
              <button
                key={String(v)}
                onClick={() => onUpdate("noiseReduction", v)}
                className={`flex-1 rounded-lg py-1.5 text-xs transition-colors ${
                  settings.noiseReduction === v
                    ? "bg-indigo-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:text-white"
                }`}
              >
                {v === "near_field" ? "Headphones" : v === "far_field" ? "Speaker" : "Off"}
              </button>
            ))}
          </div>
        </div>

        {/* Idle auto-stop */}
        <div className="space-y-2">
          <div>
            <p className="text-white text-sm font-medium">Auto-stop por inactividad</p>
            <p className="text-gray-500 text-xs">End session after this long with no speech</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {IDLE_OPTIONS.map(({ label, value }) => (
              <button
                key={value}
                onClick={() => onUpdate("idleTimeoutMs", value)}
                className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${
                  settings.idleTimeoutMs === value
                    ? "bg-indigo-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Show cost toggle */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-white text-sm font-medium">Mostrar coste estimado</p>
            <p className="text-gray-500 text-xs">Live USD cost for the current session</p>
          </div>
          <button
            role="switch"
            aria-checked={settings.showCost}
            onClick={() => onUpdate("showCost", !settings.showCost)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
              settings.showCost ? "bg-indigo-600" : "bg-gray-700"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                settings.showCost ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
