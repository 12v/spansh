"use client";

import { useCallback, useState } from "react";

export interface Settings {
  /** VAD activation threshold (0–1). Higher = needs louder audio to trigger. */
  vadThreshold: number;
  /** Silence duration in ms before the model responds. */
  vadSilenceDurationMs: number;
  /** Show a running cost estimate for the current session on-screen. */
  showCost: boolean;
  /**
   * Server-side noise reduction applied before VAD processing.
   * 'near_field' — headphones or mic close to mouth (most common).
   * 'far_field' — laptop mic or speakerphone.
   * null — disabled.
   */
  noiseReduction: "near_field" | "far_field" | null;
  /**
   * Auto-stop the session after this many ms of no speech activity.
   * 0 = never auto-stop.
   */
  idleTimeoutMs: number;
}

export const DEFAULT_SETTINGS: Settings = {
  vadThreshold: 0.5,
  vadSilenceDurationMs: 800,
  showCost: false,
  noiseReduction: "near_field",
  idleTimeoutMs: 5 * 60 * 1000, // 5 minutes
};

const STORAGE_KEY = "spansh-settings";

function loadSettings(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(loadSettings);

  const updateSetting = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore quota/security errors
      }
      return next;
    });
  }, []);

  return { settings, updateSetting };
}
