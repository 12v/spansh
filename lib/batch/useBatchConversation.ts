"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Persona } from "@/lib/personas/types";
import type { Settings } from "@/lib/settings/useSettings";
import { useVad } from "./useVad";
import { usePlayback } from "./usePlayback";

export type BatchState = "idle" | "recording" | "processing" | "playing" | "error";

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export function useBatchConversation(
  persona: Persona | null,
  settings: Pick<Settings, "ttsModel" | "gptModel" | "sttModel">
) {
  const [batchState, setBatchState] = useState<BatchState>("idle");
  const [micReady, setMicReady] = useState(false);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentTranscript, setCurrentTranscript] = useState("");
  const [currentReply, setCurrentReply] = useState("");
  const [conversationActive, setConversationActive] = useState(false);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const sessionStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const conversationActiveRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // AudioContext is session-scoped; must be created synchronously in a gesture handler
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Screen wake lock — acquired for the duration of an active conversation
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  // Forward ref for stopAndProcessInternal — needed so useVad can call it before
  // it's defined (circular dependency: VAD calls stopAndProcess; stopAndProcess needs stopVad)
  const stopAndProcessRef = useRef<() => void>(() => {});

  const { speechDetected, speechDetectedRef, startVad, stopVad } = useVad(
    audioCtxRef,
    () => stopAndProcessRef.current()
  );

  const {
    playbackVolume,
    preparePlayback,
    handleAudioChunk,
    finalizeAudioStream,
    cleanupPlayback,
  } = usePlayback(audioCtxRef, batchState === "playing", () => setBatchState("idle"));

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

  const stopAndProcessInternal = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;

    const hadSpeech = speechDetectedRef.current;
    stopVad();
    // Mute mic tracks during processing/playback so iOS doesn't duck the AI audio
    sessionStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = false; });

    setBatchState("processing");
    setCurrentTranscript("");
    setCurrentReply("");

    preparePlayback();

    (async () => {
      try {
        await new Promise<void>((resolve) => {
          recorder.onstop = () => resolve();
          recorder.stop();
        });

        recorderRef.current = null;

        if (!hadSpeech) {
          chunksRef.current = [];
          setErrorMessage("No se detectó audio. Intenta de nuevo.");
          setBatchState("idle");
          return;
        }

        if (!conversationActiveRef.current) {
          chunksRef.current = [];
          return;
        }

        const mimeType = recorder.mimeType || "audio/webm";
        const ext = mimeType.includes("mp4") ? "mp4" : "webm";
        const blob = new Blob(chunksRef.current, { type: mimeType });
        chunksRef.current = [];

        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        const formData = new FormData();
        formData.append("audio", blob, `recording.${ext}`);
        formData.append("personaId", persona!.id);
        formData.append("history", JSON.stringify(messagesRef.current));
        formData.append("ttsModel", settingsRef.current.ttsModel);
        formData.append("gptModel", settingsRef.current.gptModel);
        formData.append("sttModel", settingsRef.current.sttModel);
        formData.append("audioFormat", "pcm");

        const res = await fetch("/api/process-speech", {
          method: "POST",
          body: formData,
          signal: abortController.signal,
        });

        if (!res.ok || !res.body) {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(err.error ?? `Error ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = "";
        let finalTranscript = "";
        let finalReply = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          sseBuffer += decoder.decode(value, { stream: true });

          const events = sseBuffer.split("\n\n");
          sseBuffer = events.pop() ?? "";

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
                handleAudioChunk(data.data);
                break;

              case "done": {
                if (data.transcript) finalTranscript = data.transcript;
                if (data.reply) finalReply = data.reply;
                setMessages((prev) => [
                  ...prev,
                  { role: "user", content: finalTranscript },
                  { role: "assistant", content: finalReply },
                ]);
                setCurrentTranscript("");
                setCurrentReply("");
                setBatchState(finalizeAudioStream());
                break;
              }

              case "error":
                throw new Error(data.message);
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        const msg = err instanceof Error ? err.message : "Error al procesar";
        setErrorMessage(msg);
        setBatchState("error");
      }
    })();
  }, [persona, stopVad, preparePlayback, handleAudioChunk, finalizeAudioStream]);

  // Keep forward ref current so useVad's onEndOfSpeech always calls the latest version
  stopAndProcessRef.current = stopAndProcessInternal;

  const startRecordingTurn = useCallback(() => {
    if (!conversationActiveRef.current || !sessionStreamRef.current || batchState !== "idle") return;

    const stream = sessionStreamRef.current;
    setErrorMessage(null);
    // Re-enable mic tracks for this recording turn (were muted during processing/playback)
    stream.getAudioTracks().forEach(t => { t.enabled = true; });

    if (!startVad(stream)) return;

    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.start();
    setBatchState("recording");
  }, [batchState, startVad]);

  // Auto-restart: when state returns to idle during an active session, start the next turn
  useEffect(() => {
    if (batchState === "idle" && conversationActiveRef.current) {
      const timer = setTimeout(() => {
        if (conversationActiveRef.current) startRecordingTurn();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [batchState, conversationActive, startRecordingTurn]);

  const startConversation = useCallback(async () => {
    if (!persona || conversationActiveRef.current) return;
    setErrorMessage(null);

    // Create AudioContext synchronously within the gesture handler — iOS Safari requires
    // this before any await, otherwise the context starts suspended and can't be resumed.
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = new AudioContext();
    audioCtxRef.current.resume().catch(() => {});

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      sessionStreamRef.current = stream;

      conversationActiveRef.current = true;
      setConversationActive(true);
      navigator.wakeLock?.request('screen').then(lock => {
        wakeLockRef.current = lock;
      }).catch(() => {});
    } catch (err) {
      audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
      const msg = err instanceof Error ? err.message : "No se pudo acceder al micrófono";
      setErrorMessage(msg);
      setBatchState("error");
    }
  }, [persona]);

  const stopConversation = useCallback(() => {
    conversationActiveRef.current = false;
    setConversationActive(false);

    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;

    abortControllerRef.current?.abort();
    abortControllerRef.current = null;

    stopVad();

    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.ondataavailable = null;
      recorder.stop();
    }
    recorderRef.current = null;
    chunksRef.current = [];

    sessionStreamRef.current?.getTracks().forEach((t) => t.stop());
    sessionStreamRef.current = null;

    cleanupPlayback();

    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;

    setBatchState("idle");
  }, [stopVad, cleanupPlayback]);

  // Re-acquire wake lock when the page becomes visible again (OS releases it on page hide)
  useEffect(() => {
    const reacquire = () => {
      if (document.visibilityState === 'visible' && conversationActiveRef.current) {
        navigator.wakeLock?.request('screen').then(lock => {
          wakeLockRef.current = lock;
        }).catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', reacquire);
    return () => document.removeEventListener('visibilitychange', reacquire);
  }, []);

  const reset = useCallback(() => {
    conversationActiveRef.current = false;
    setConversationActive(false);

    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;

    abortControllerRef.current?.abort();
    abortControllerRef.current = null;

    stopVad();

    sessionStreamRef.current?.getTracks().forEach((t) => t.stop());
    sessionStreamRef.current = null;

    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.ondataavailable = null;
      recorder.stop();
    }
    recorderRef.current = null;
    chunksRef.current = [];

    cleanupPlayback();

    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;

    setMicReady(false);
    setMessages([]);
    setCurrentTranscript("");
    setCurrentReply("");
    setErrorMessage(null);
    setBatchState("idle");
  }, [stopVad, cleanupPlayback]);

  return {
    batchState,
    micReady,
    messages,
    errorMessage,
    currentTranscript,
    currentReply,
    playbackVolume,
    conversationActive,
    speechDetected,
    prepareMic,
    startConversation,
    stopConversation,
    reset,
  };
}
