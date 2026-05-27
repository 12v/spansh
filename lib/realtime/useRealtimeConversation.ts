"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  RealtimeAgent,
  RealtimeSession,
  OpenAIRealtimeWebRTC,
} from "@openai/agents-realtime";
import type { Persona } from "@/lib/personas/types";

export type ConnectionState = "idle" | "connecting" | "active" | "error";

export function useRealtimeConversation(persona: Persona | null) {
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [conversationActive, setConversationActive] = useState(false);
  const [speechDetected, setSpeechDetected] = useState(false);
  const [isModelSpeaking, setIsModelSpeaking] = useState(false);
  const [playbackVolume, setPlaybackVolume] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const sessionRef = useRef<RealtimeSession | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const conversationActiveRef = useRef(false);

  // ── RAF loop for playback volume glow ─────────────────────────────────────

  const stopRaf = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setPlaybackVolume(0);
  }, []);

  const startRaf = useCallback(() => {
    if (rafRef.current !== null) return;
    const analyser = analyserRef.current;
    if (!analyser) return;
    const buf = new Uint8Array(analyser.frequencyBinCount);

    function tick() {
      if (!analyserRef.current) return;
      analyserRef.current.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      setPlaybackVolume(Math.min(Math.sqrt(sum / buf.length) * 5, 1));
      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    if (isModelSpeaking) {
      startRaf();
    } else {
      stopRaf();
    }
  }, [isModelSpeaking, startRaf, stopRaf]);

  // ── Teardown ───────────────────────────────────────────────────────────────

  const teardown = useCallback(() => {
    stopRaf();

    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;

    sessionRef.current?.close();
    sessionRef.current = null;

    analyserRef.current?.disconnect();
    analyserRef.current = null;

    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
  }, [stopRaf]);

  // ── startConversation ──────────────────────────────────────────────────────

  const startConversation = useCallback(async () => {
    if (!persona || conversationActiveRef.current) return;
    setErrorMessage(null);
    setConnectionState("connecting");

    // Create AudioContext synchronously inside the gesture handler —
    // iOS Safari requires this before any await or the context starts suspended.
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = new AudioContext();
    audioCtxRef.current.resume().catch(() => {});

    // Analyser feeds the volume glow; connect to destination so Web Audio
    // actually processes the graph (and bypasses the iOS silent switch).
    const analyser = audioCtxRef.current.createAnalyser();
    analyser.fftSize = 256;
    analyser.connect(audioCtxRef.current.destination);
    analyserRef.current = analyser;

    try {
      // 1. Fetch ephemeral client secret
      const tokenRes = await fetch(
        `/api/realtime?personaId=${encodeURIComponent(persona.id)}`
      );
      if (!tokenRes.ok) {
        const err = await tokenRes.json().catch(() => ({ error: tokenRes.statusText }));
        throw new Error(err.error ?? `HTTP ${tokenRes.status}`);
      }
      const data = await tokenRes.json();
      const token: string = data.client_secret?.value;
      if (!token) throw new Error(`No token in response: ${JSON.stringify(data)}`);

      // 2. Build the persona agent
      const instructions = [persona.systemPrompt, persona.voiceInstructions]
        .filter(Boolean)
        .join("\n\n");

      const agent = new RealtimeAgent({
        name: persona.displayName,
        instructions,
        voice: persona.voice,
      });

      // 3. Custom WebRTC transport: override pc.ontrack to route remote audio
      //    through Web Audio API (iOS silent-switch bypass + volume-glow analyser).
      //    The SDK sets pc.ontrack before calling changePeerConnection, so
      //    reassigning it here replaces the SDK's default <audio> playback path.
      const transport = new OpenAIRealtimeWebRTC({
        changePeerConnection: async (pc) => {
          pc.ontrack = (event) => {
            const ctx = audioCtxRef.current;
            const analyserNode = analyserRef.current;
            if (!ctx || !analyserNode) return;
            ctx.createMediaStreamSource(event.streams[0]).connect(analyserNode);
          };
          return pc;
        },
      });

      // 4. Create session — transcription disabled (no text display needed)
      const session = new RealtimeSession(agent, {
        transport,
        model: "gpt-realtime-mini",
        tracingDisabled: true,
        config: {
          audio: {
            input: {
              transcription: null,
              turnDetection: {
                type: "server_vad",
                silenceDurationMs: 800,
                threshold: 0.5,
                prefixPaddingMs: 300,
              },
            },
          },
        },
      });
      sessionRef.current = session;

      // 5. Wire events

      // VAD signals — drive button colour
      session.on("transport_event", (event) => {
        const e = event as { type: string };
        if (e.type === "input_audio_buffer.speech_started") {
          setSpeechDetected(true);
          setErrorMessage(null);
        }
        if (e.type === "input_audio_buffer.speech_stopped") {
          setSpeechDetected(false);
        }
      });

      // Model audio signals — drive glow
      session.on("audio_start",       () => setIsModelSpeaking(true));
      session.on("audio_stopped",     () => setIsModelSpeaking(false));
      session.on("audio_interrupted", () => setIsModelSpeaking(false));

      // Errors
      session.on("error", ({ error }) => {
        const msg = error instanceof Error ? error.message : String(error);
        setErrorMessage(msg);
        setConnectionState("error");
      });

      // 6. Connect — SDK handles getUserMedia, RTCPeerConnection, SDP exchange,
      //    session.update with agent instructions + VAD config.
      await session.connect({ apiKey: token });

      conversationActiveRef.current = true;
      setConversationActive(true);
      setConnectionState("active");

      navigator.wakeLock
        ?.request("screen")
        .then((lock) => { wakeLockRef.current = lock; })
        .catch(() => {});
    } catch (err) {
      teardown();
      const msg = err instanceof Error ? err.message : "Error al conectar";
      console.error("[useRealtimeConversation] startConversation failed:", msg);
      setErrorMessage(msg);
      setConnectionState("error");
    }
  }, [persona, teardown]);

  // ── stopConversation / reset ───────────────────────────────────────────────

  const stopConversation = useCallback(() => {
    conversationActiveRef.current = false;
    setConversationActive(false);
    setSpeechDetected(false);
    setIsModelSpeaking(false);
    teardown();
    setConnectionState("idle");
  }, [teardown]);

  const reset = useCallback(() => {
    conversationActiveRef.current = false;
    setConversationActive(false);
    setSpeechDetected(false);
    setIsModelSpeaking(false);
    teardown();
    setErrorMessage(null);
    setConnectionState("idle");
  }, [teardown]);

  // Re-acquire wake lock when the page becomes visible
  useEffect(() => {
    const reacquire = () => {
      if (document.visibilityState === "visible" && conversationActiveRef.current) {
        navigator.wakeLock
          ?.request("screen")
          .then((lock) => { wakeLockRef.current = lock; })
          .catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", reacquire);
    return () => document.removeEventListener("visibilitychange", reacquire);
  }, []);

  return {
    connectionState,
    conversationActive,
    speechDetected,
    isModelSpeaking,
    playbackVolume,
    errorMessage,
    startConversation,
    stopConversation,
    reset,
  };
}
