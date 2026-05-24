"use client";

import { useCallback, useRef, useState } from "react";
import type { Persona } from "@/lib/personas/types";

export type BatchState = "idle" | "recording" | "processing" | "error";

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export function useBatchConversation(persona: Persona | null) {
  const [batchState, setBatchState] = useState<BatchState>("idle");
  const [micReady, setMicReady] = useState(false);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentTranscript, setCurrentTranscript] = useState("");
  const [currentReply, setCurrentReply] = useState("");

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  // Silence detection: sample RMS every 50 ms while recording
  const analyserCtxRef = useRef<AudioContext | null>(null);
  const silenceIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const maxRmsRef = useRef(0);

  const stopSilenceDetection = useCallback(() => {
    if (silenceIntervalRef.current !== null) {
      clearInterval(silenceIntervalRef.current);
      silenceIntervalRef.current = null;
    }
    analyserCtxRef.current?.close().catch(() => {});
    analyserCtxRef.current = null;
  }, []);

  // Web Audio API for gapless sentence-by-sentence playback
  const audioCtxRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef(0);

  const scheduleAudioChunk = useCallback((base64: string) => {
    const ctx = (audioCtxRef.current ??= new AudioContext());
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    // decodeAudioData consumes the buffer, so we need a copy
    const buffer = bytes.buffer.slice(0);
    ctx.decodeAudioData(buffer).then((audioBuffer) => {
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      // Schedule immediately after the previous chunk ends
      const startAt = Math.max(ctx.currentTime, nextStartTimeRef.current);
      source.start(startAt);
      nextStartTimeRef.current = startAt + audioBuffer.duration;
    }).catch(() => {});
  }, []);

  // Call once when a persona is selected to prompt for mic permission before the
  // first recording, so the permission dialog doesn't interrupt the user speaking.
  const prepareMic = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setMicReady(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo acceder al micrófono";
      setErrorMessage(msg);
      setBatchState("error");
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (!persona || batchState !== "idle") return;
    setErrorMessage(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;

      // Wire up silence detection via AnalyserNode
      maxRmsRef.current = 0;
      const actx = new AudioContext();
      analyserCtxRef.current = actx;
      const analyser = actx.createAnalyser();
      analyser.fftSize = 256;
      actx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      silenceIntervalRef.current = setInterval(() => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        if (rms > maxRmsRef.current) maxRmsRef.current = rms;
      }, 50);

      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.start();
      setBatchState("recording");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo acceder al micrófono";
      setErrorMessage(msg);
      setBatchState("error");
    }
  }, [persona, batchState]);

  // Stop and discard the current recording without sending it to the server.
  const cancelRecording = useCallback(() => {
    stopSilenceDetection();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.ondataavailable = null;
      recorder.stop();
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
    setBatchState("idle");
  }, [stopSilenceDetection]);

  const SILENCE_THRESHOLD = 0.01;

  const stopAndProcess = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder || batchState !== "recording") return;

    // Capture the max RMS before stopping the analyser
    const peakRms = maxRmsRef.current;
    stopSilenceDetection();

    setBatchState("processing");
    setCurrentTranscript("");
    setCurrentReply("");
    nextStartTimeRef.current = 0;

    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;

    // Bail out early if no meaningful audio was detected
    if (peakRms < SILENCE_THRESHOLD) {
      chunksRef.current = [];
      setErrorMessage("No se detectó audio. Intenta de nuevo.");
      setBatchState("idle");
      return;
    }

    const mimeType = recorder.mimeType || "audio/webm";
    const ext = mimeType.includes("mp4") ? "mp4" : "webm";
    const blob = new Blob(chunksRef.current, { type: mimeType });
    chunksRef.current = [];

    try {
      const formData = new FormData();
      formData.append("audio", blob, `recording.${ext}`);
      formData.append("personaId", persona!.id);
      formData.append("history", JSON.stringify(messagesRef.current));

      const res = await fetch("/api/process-speech", { method: "POST", body: formData });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error ?? `Error ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let finalTranscript = "";
      let finalReply = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        const events = buf.split("\n\n");
        buf = events.pop() ?? "";

        for (const event of events) {
          const dataLine = event.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          const data = JSON.parse(dataLine.slice(6));

          switch (data.type) {
            case "transcript":
              finalTranscript = data.text;
              setCurrentTranscript(data.text);
              break;
            case "text_delta":
              setCurrentReply((prev) => prev + data.text);
              finalReply += data.text;
              break;
            case "audio_chunk":
              scheduleAudioChunk(data.data);
              break;
            case "done":
              if (data.transcript) finalTranscript = data.transcript;
              if (data.reply) finalReply = data.reply;
              setMessages((prev) => [
                ...prev,
                { role: "user", content: finalTranscript },
                { role: "assistant", content: finalReply },
              ]);
              setCurrentTranscript("");
              setCurrentReply("");
              setBatchState("idle");
              break;
            case "error":
              throw new Error(data.message);
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error al procesar";
      setErrorMessage(msg);
      setBatchState("error");
    }
  }, [persona, batchState, scheduleAudioChunk]);

  const reset = useCallback(() => {
    stopSilenceDetection();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
    nextStartTimeRef.current = 0;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    setMicReady(false);
    setMessages([]);
    setCurrentTranscript("");
    setCurrentReply("");
    setErrorMessage(null);
    setBatchState("idle");
  }, []);

  return {
    batchState,
    micReady,
    messages,
    errorMessage,
    currentTranscript,
    currentReply,
    prepareMic,
    startRecording,
    cancelRecording,
    stopAndProcess,
    reset,
  };
}
