"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import type { Settings } from "@/lib/settings/useSettings";

interface SettingsPanelProps {
  settings: Settings;
  onUpdate: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  onClose: () => void;
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-2 px-3 rounded-lg text-sm border transition-colors ${
        active
          ? "bg-indigo-600 border-indigo-500 text-white"
          : "bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600"
      }`}
    >
      {children}
    </button>
  );
}

export function SettingsPanel({ settings, onUpdate, onClose }: SettingsPanelProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-white font-semibold text-lg">Ajustes</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* TTS model */}
        <div className="mb-5">
          <p className="text-white text-sm font-medium mb-0.5">Calidad de voz</p>
          <p className="text-gray-500 text-xs mb-2">Mini follows accent instructions — recommended</p>
          <div className="flex gap-2">
            <ToggleButton
              active={settings.ttsModel === "gpt-4o-mini-tts"}
              onClick={() => onUpdate("ttsModel", "gpt-4o-mini-tts")}
            >
              Mini
            </ToggleButton>
            <ToggleButton
              active={settings.ttsModel === "tts-1"}
              onClick={() => onUpdate("ttsModel", "tts-1")}
            >
              Estándar
            </ToggleButton>
            <ToggleButton
              active={settings.ttsModel === "tts-1-hd"}
              onClick={() => onUpdate("ttsModel", "tts-1-hd")}
            >
              HD
            </ToggleButton>
          </div>
        </div>

        {/* GPT model */}
        <div className="mb-5">
          <p className="text-white text-sm font-medium mb-0.5">Modelo de respuesta</p>
          <p className="text-gray-500 text-xs mb-2">Better quality costs ~5× more per reply</p>
          <div className="flex gap-2">
            <ToggleButton
              active={settings.gptModel === "gpt-4o-mini"}
              onClick={() => onUpdate("gptModel", "gpt-4o-mini")}
            >
              Rápido
            </ToggleButton>
            <ToggleButton
              active={settings.gptModel === "gpt-4o"}
              onClick={() => onUpdate("gptModel", "gpt-4o")}
            >
              Mejor
            </ToggleButton>
          </div>
        </div>

        {/* Listening mode */}
        <div className="flex items-center justify-between pt-1">
          <div>
            <p className="text-white text-sm font-medium">Modo escucha</p>
            <p className="text-gray-500 text-xs">Hide text — comprehend by ear only</p>
          </div>
          <button
            onClick={() => onUpdate("listeningMode", !settings.listeningMode)}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
              settings.listeningMode ? "bg-indigo-600" : "bg-gray-700"
            }`}
            aria-pressed={settings.listeningMode}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                settings.listeningMode ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
