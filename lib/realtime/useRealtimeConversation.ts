"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
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

  // ── Data channel event handler ─────────────────────────────────────────────
  // useCallback([], []) — stable: only reads refs and calls stable setState fns.

  const handleEvent = useCallback((event: MessageEvent) => {
    let data: { type: string; [key: string]: unknown };
    try {
      data = JSON.parse(event.data as string);
    } catch {
      return;
    }

    switch (data.type) {
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
        const transcript = (data.transcript as string) ?? "";
        pendingTranscriptRef.current = transcript;
        setCurrentTranscript(transcript);
        break;
      }

      // Model begins generating a response — audio will start flowing on the WebRTC track
      case "response.created":
        setBatchState("playing");
        break;

      // Streaming transcript of what the model is saying (mirrors the audio track)
      case "response.audio_transcript.delta": {
        const delta = (data.delta as string) ?? "";
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
          (data.error as { message?: string } | undefined)?.message ??
          "Error desconocido";
        setErrorMessage(errMsg);
        setBatchState("error");
        break;
      }
    }
  }, []);

  // ── Teardown ───────────────────────────────────────────────────────────────

  const teardown = useCallback(() => {
    stopRaf();

    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;

    if (dcRef.current) {
      dcRef.current.onmessage = null;
      dcRef.current.onopen = null;
      dcRef.current.close();
      dcRef.current = null;
    }

    if (pcRef.current) {
      pcRef.current.ontrack = null;
      // Stop all local mic tracks
      pcRef.current.getSenders().forEach((s) => s.track?.stop());
      pcRef.current.close();
      pcRef.current = null;
    }

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
      const secret = await tokenRes.json();
      const token: string = secret.value;
      if (!token) throw new Error(`No token in session response: ${JSON.stringify(secret)}`);

      // 2. Capture mic
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });

      // 3. Create RTCPeerConnection and add mic track
      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      // 4. Route remote audio through Web Audio (bypasses iOS silent switch)
      //    createMediaStreamSource → analyser → destination
      pc.ontrack = (e) => {
        const ctx = audioCtxRef.current;
        const analyserNode = analyserRef.current;
        if (!ctx || !analyserNode) return;
        const source = ctx.createMediaStreamSource(e.streams[0]);
        source.connect(analyserNode);
      };

      // 5. Data channel for JSON events
      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;

      // Send session.update once the channel is open — by this point the
      // server has received our SDP and the session is ready.
      dc.onopen = () => {
        const channel = dcRef.current;
        if (!channel || channel.readyState !== "open") return;
        const instructions = [persona.systemPrompt, persona.voiceInstructions]
          .filter(Boolean)
          .join("\n\n");
        channel.send(
          JSON.stringify({
            type: "session.update",
            session: {
              voice: persona.voice,
              instructions,
              input_audio_transcription: {
                model: "gpt-4o-mini-transcribe",
                language: "es",
              },
              turn_detection: {
                type: "server_vad",
                silence_duration_ms: 800,
                threshold: 0.5,
                prefix_padding_ms: 300,
              },
            },
          })
        );
      };

      dc.onmessage = handleEvent;

      // 6. SDP offer/answer with OpenAI
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // GA Realtime API — model is embedded in the ek_ token, no ?model= param
      const sdpRes = await fetch(
        "https://api.openai.com/v1/realtime",
        {
          method: "POST",
          body: offer.sdp,
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/sdp",
          },
        }
      );
      if (!sdpRes.ok) {
        const errBody = await sdpRes.text().catch(() => "");
        throw new Error(`SDP exchange failed: ${sdpRes.status} ${errBody || sdpRes.statusText}`);
      }

      const answerSdp = await sdpRes.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

      // WebRTC connected — mark conversation active
      conversationActiveRef.current = true;
      setConversationActive(true);
      setBatchState("idle");

      navigator.wakeLock
        ?.request("screen")
        .then((lock) => {
          wakeLockRef.current = lock;
        })
        .catch(() => {});
    } catch (err) {
      teardown();
      const msg = err instanceof Error ? err.message : "Error al conectar";
      console.error("[useRealtimeConversation] startConversation failed:", msg);
      setErrorMessage(msg);
      setBatchState("error");
    }
  }, [persona, handleEvent, teardown]);

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
          .then((lock) => {
            wakeLockRef.current = lock;
          })
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
