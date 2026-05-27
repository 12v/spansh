"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  RealtimeAgent,
  RealtimeSession,
  OpenAIRealtimeWebRTC,
} from "@openai/agents-realtime";
import type { Persona } from "@/lib/personas/types";

export type BatchState = "idle" | "connecting" | "recording" | "processing" | "playing" | "error";

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export function useRealtimeConversation(persona: Persona | null) {
  const [batchState, setBatchState] = useState<BatchState>("idle");
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentTranscript, setCurrentTranscript] = useState("");
  const [currentReply, setCurrentReply] = useState("");
  const [conversationActive, setConversationActive] = useState(false);
  const [speechDetected, setSpeechDetected] = useState(false);
  const [playbackVolume, setPlaybackVolume] = useState(0);

  const sessionRef = useRef<RealtimeSession | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const conversationActiveRef = useRef(false);

  // Accumulate in refs so the event handler (stable closure) always reads latest
  const pendingTranscriptRef = useRef("");
  const pendingReplyRef = useRef("");

  // ── RAF loop for playback volume glow ─────────────────────────────────────

  const stopRaf = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setPlaybackVolume(0);
  }, []);

  const startRaf = useCallback(() => {
    if (rafRef.current !== null) return; // already running
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

  // Drive RAF from batchState
  useEffect(() => {
    if (batchState === "playing") {
      startRaf();
    } else {
      stopRaf();
    }
  }, [batchState, startRaf, stopRaf]);

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

    pendingTranscriptRef.current = "";
    pendingReplyRef.current = "";
  }, [stopRaf]);

  // ── startConversation ──────────────────────────────────────────────────────

  const startConversation = useCallback(async () => {
    if (!persona || conversationActiveRef.current) return;
    setErrorMessage(null);
    setBatchState("connecting"); // immediate visual feedback before any async work

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
      // 1. Fetch ephemeral client secret from our API route
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

      // 2. Build the persona agent (instructions + voice set here)
      const instructions = [persona.systemPrompt, persona.voiceInstructions]
        .filter(Boolean)
        .join("\n\n");

      const agent = new RealtimeAgent({
        name: persona.displayName,
        instructions,
        voice: persona.voice,
      });

      // 3. Custom WebRTC transport:
      //    – override pc.ontrack to route remote audio through Web Audio API
      //      (bypasses iOS silent switch; feeds the volume-glow analyser)
      //    – the SDK sets pc.ontrack = (e) => audioEl.srcObject = e.streams[0]
      //      before calling changePeerConnection, so reassigning ontrack here
      //      replaces the SDK's default playback path entirely.
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

      // 4. Create session: model locked to gpt-realtime-mini, Spanish transcription,
      //    server VAD tuned for natural speech pacing.
      const session = new RealtimeSession(agent, {
        transport,
        model: "gpt-realtime-mini",
        tracingDisabled: true,
        config: {
          audio: {
            input: {
              transcription: { model: "gpt-4o-mini-transcribe", language: "es" },
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

      // 5. Wire raw data-channel events for BatchState + transcript accumulation
      session.on("transport_event", (event) => {
        const e = event as { type: string; [key: string]: unknown };

        switch (e.type) {
          // User started speaking — reset accumulators for the new turn
          case "input_audio_buffer.speech_started":
            pendingTranscriptRef.current = "";
            pendingReplyRef.current = "";
            setCurrentTranscript("");
            setCurrentReply("");
            setBatchState("recording");
            setSpeechDetected(true);
            setErrorMessage(null);
            break;

          // User stopped speaking — waiting for model response
          case "input_audio_buffer.speech_stopped":
            setBatchState("processing");
            setSpeechDetected(false);
            break;

          // User's speech transcription ready
          case "conversation.item.input_audio_transcription.completed": {
            const transcript = (e.transcript as string) ?? "";
            pendingTranscriptRef.current = transcript;
            setCurrentTranscript(transcript);
            break;
          }

          // Model begins generating a response
          case "response.created":
            setBatchState("playing");
            break;

          // Streaming transcript of what the model is saying
          case "response.audio_transcript.delta": {
            const delta = (e.delta as string) ?? "";
            pendingReplyRef.current += delta;
            setCurrentReply((prev) => prev + delta);
            break;
          }

          // Response fully done — commit to conversation history
          case "response.done": {
            const finalTranscript = pendingTranscriptRef.current;
            const finalReply = pendingReplyRef.current;
            pendingTranscriptRef.current = "";
            pendingReplyRef.current = "";
            if (finalTranscript || finalReply) {
              setMessages((prev) => [
                ...prev,
                { role: "user", content: finalTranscript },
                { role: "assistant", content: finalReply },
              ]);
            }
            setCurrentTranscript("");
            setCurrentReply("");
            setBatchState("idle");
            break;
          }

          case "error": {
            const errMsg =
              (e.error as { message?: string } | undefined)?.message ??
              "Error desconocido";
            setErrorMessage(errMsg);
            setBatchState("error");
            break;
          }
        }
      });

      // Session-level error handler (covers SDK/transport errors not in data channel)
      session.on("error", ({ error }) => {
        const msg = error instanceof Error ? error.message : String(error);
        setErrorMessage(msg);
        setBatchState("error");
      });

      // 6. Connect — SDK handles: getUserMedia, RTCPeerConnection, SDP to /v1/realtime/calls,
      //    session.update with agent instructions + VAD/transcription config.
      await session.connect({ apiKey: token });

      conversationActiveRef.current = true;
      setConversationActive(true);
      setBatchState("idle");

      navigator.wakeLock
        ?.request("screen")
        .then((lock) => { wakeLockRef.current = lock; })
        .catch(() => {});
    } catch (err) {
      teardown();
      const msg = err instanceof Error ? err.message : "Error al conectar";
      console.error("[useRealtimeConversation] startConversation failed:", msg);
      setErrorMessage(msg);
      setBatchState("error");
    }
  }, [persona, teardown]);

  // ── stopConversation / reset ───────────────────────────────────────────────

  const stopConversation = useCallback(() => {
    conversationActiveRef.current = false;
    setConversationActive(false);
    teardown();
    setBatchState("idle");
  }, [teardown]);

  const reset = useCallback(() => {
    conversationActiveRef.current = false;
    setConversationActive(false);
    teardown();
    setMessages([]);
    setCurrentTranscript("");
    setCurrentReply("");
    setErrorMessage(null);
    setSpeechDetected(false);
    setBatchState("idle");
  }, [teardown]);

  // Re-acquire wake lock when the page becomes visible (OS releases it on page hide)
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
    batchState,
    micReady: true, // no pre-flight needed; permission requested in startConversation
    messages,
    errorMessage,
    currentTranscript,
    currentReply,
    playbackVolume,
    conversationActive,
    speechDetected,
    prepareMic: async () => {}, // no-op — kept for ConversationPage compatibility
    startConversation,
    stopConversation,
    reset,
  };
}
