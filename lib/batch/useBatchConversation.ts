"use client";

import { useCallback, useRef, useState } from "react";
import type { Persona } from "@/lib/personas/types";

export type BatchState = "idle" | "recording" | "processing" | "error";

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export function useBatchConversation(
  persona: Persona | null,
  audioRef: React.RefObject<HTMLAudioElement | null>
) {
  const [batchState, setBatchState] = useState<BatchState>("idle");
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const startRecording = useCallback(async () => {
    if (!persona || batchState !== "idle") return;
    setErrorMessage(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
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

  const stopAndProcess = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder || batchState !== "recording") return;

    setBatchState("processing");

    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;

    const mimeType = recorder.mimeType || "audio/webm";
    const ext = mimeType.includes("mp4") ? "mp4" : "webm";
    const blob = new Blob(chunksRef.current, { type: mimeType });
    chunksRef.current = [];

    try {
      const formData = new FormData();
      formData.append("audio", blob, `recording.${ext}`);
      formData.append("personaId", persona!.id);
      formData.append("history", JSON.stringify(messagesRef.current));

      const res = await fetch("/api/process-speech", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error ?? `Error ${res.status}`);
      }

      const { transcript, reply, audio: audioBase64 } = await res.json();

      setMessages((prev) => [
        ...prev,
        { role: "user", content: transcript },
        { role: "assistant", content: reply },
      ]);

      const audioBytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
      const audioBlob = new Blob([audioBytes], { type: "audio/mpeg" });
      const url = URL.createObjectURL(audioBlob);

      if (audioRef.current) {
        audioRef.current.src = url;
        await audioRef.current.play().catch(() => {});
      }

      setBatchState("idle");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error al procesar";
      setErrorMessage(msg);
      setBatchState("error");
    }
  }, [persona, batchState, audioRef]);

  const reset = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
    setMessages([]);
    setErrorMessage(null);
    setBatchState("idle");
  }, []);

  return { batchState, messages, errorMessage, startRecording, stopAndProcess, reset };
}
