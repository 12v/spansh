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
  const [currentTranscript, setCurrentTranscript] = useState("");
  const [currentReply, setCurrentReply] = useState("");

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  // Audio playback queue
  const audioQueueRef = useRef<string[]>([]);
  const isPlayingRef = useRef(false);

  const playNextInQueue = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      return;
    }
    isPlayingRef.current = true;
    const url = audioQueueRef.current.shift()!;
    audio.src = url;
    audio.play().catch(() => {});
    const cleanup = () => {
      URL.revokeObjectURL(url);
      audio.removeEventListener("ended", cleanup);
      audio.removeEventListener("error", cleanup);
      playNextInQueue();
    };
    audio.addEventListener("ended", cleanup, { once: true });
    audio.addEventListener("error", cleanup, { once: true });
  }, [audioRef]);

  const enqueueAudio = useCallback(
    (base64: string) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "audio/mpeg" });
      const url = URL.createObjectURL(blob);
      audioQueueRef.current.push(url);
      if (!isPlayingRef.current) {
        playNextInQueue();
      }
    },
    [playNextInQueue]
  );

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
    setCurrentTranscript("");
    setCurrentReply("");
    audioQueueRef.current = [];
    isPlayingRef.current = false;

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

        // Parse complete SSE events (separated by \n\n)
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
              enqueueAudio(data.data);
              break;
            case "done":
              // Prefer server-provided values if present
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
  }, [persona, batchState, enqueueAudio]);

  const reset = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
    }
    setMessages([]);
    setCurrentTranscript("");
    setCurrentReply("");
    setErrorMessage(null);
    setBatchState("idle");
  }, [audioRef]);

  return {
    batchState,
    messages,
    errorMessage,
    currentTranscript,
    currentReply,
    startRecording,
    stopAndProcess,
    reset,
  };
}
