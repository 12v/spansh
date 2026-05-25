"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Persona } from "@/lib/personas/types";
import type { Settings } from "@/lib/settings/useSettings";

export type BatchState = "idle" | "recording" | "processing" | "playing" | "error";

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

const MSE_MIME = 'audio/ogg; codecs="opus"';

// VAD via ScriptProcessorNode.onaudioprocess — receives PCM frames directly from the
// audio rendering pipeline. Works on iOS Safari where getFloatTimeDomainData returns
// zeros for MediaStreamSourceNode (WebKit bug #225564) and where MediaRecorder timeslice
// is ignored (ondataavailable only fires on stop).
const SPEECH_THRESHOLD = 0.02;
const SILENCE_THRESHOLD = 0.01;
const END_OF_SPEECH_MS = 1500;

function mseSupported(): boolean {
  return (
    typeof MediaSource !== "undefined" &&
    MediaSource.isTypeSupported(MSE_MIME)
  );
}

export function useBatchConversation(
  persona: Persona | null,
  settings: Pick<Settings, "ttsModel" | "gptModel">
) {
  const [batchState, setBatchState] = useState<BatchState>("idle");
  const [micReady, setMicReady] = useState(false);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentTranscript, setCurrentTranscript] = useState("");
  const [currentReply, setCurrentReply] = useState("");
  const [conversationActive, setConversationActive] = useState(false);
  const [speechDetected, setSpeechDetected] = useState(false);

  // Latest-value ref so VAD always reads current settings
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Session-level persistent mic stream (open for the entire conversation session)
  const sessionStreamRef = useRef<MediaStream | null>(null);

  // Per-turn recording refs
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  // VAD state — driven by ScriptProcessorNode.onaudioprocess
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const speechDetectedRef = useRef(false);
  const silenceSinceRef = useRef<number | null>(null);
  const vadActiveRef = useRef(false); // false prevents re-entrancy once auto-stop fires

  // Conversation session state (ref copy for use inside async callbacks)
  const conversationActiveRef = useRef(false);

  // Abort controller for in-flight fetch
  const abortControllerRef = useRef<AbortController | null>(null);

  // Playback — session-scoped AudioContext (created in startConversation for iOS gesture requirement)
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const [playbackVolume, setPlaybackVolume] = useState(0);

  // MSE-specific refs
  const useMseRef = useRef(false);
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const pendingChunksRef = useRef<ArrayBuffer[]>([]);
  const endOfStreamPendingRef = useRef(false);
  const drainFnRef = useRef<(() => void) | null>(null);

  // PCM fallback refs (Safari: stream 24kHz 16-bit mono PCM, schedule synchronously)
  const pcmLeftoverRef = useRef<number | null>(null);
  const nextStartTimeRef = useRef(0);

  // Screen wake lock — acquired for the duration of an active conversation
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const stopVad = useCallback(() => {
    vadActiveRef.current = false;
    speechDetectedRef.current = false;
    silenceSinceRef.current = null;
    scriptProcessorRef.current?.disconnect();
    scriptProcessorRef.current = null;
    micSourceRef.current?.disconnect();
    micSourceRef.current = null;
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

  // Internal: stop current recorder and send audio to server
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

    // Set up analyser for playback visualisation (reuses session-scoped AudioContext)
    if (audioCtxRef.current) {
      analyserRef.current = audioCtxRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
    }

    const useMse = mseSupported();
    useMseRef.current = useMse;

    let sourceOpenPromise: Promise<void> | null = null;

    if (useMse && audioCtxRef.current && analyserRef.current) {
      const ms = new MediaSource();
      const url = URL.createObjectURL(ms);
      const audioEl = new Audio();
      audioEl.src = url;

      sourceOpenPromise = new Promise<void>((resolve) => {
        ms.addEventListener("sourceopen", () => resolve(), { once: true });
      });

      const mediaElSrc = audioCtxRef.current.createMediaElementSource(audioEl);
      mediaElSrc.connect(analyserRef.current);
      analyserRef.current.connect(audioCtxRef.current.destination);

      audioEl.play().catch(() => {});

      mediaSourceRef.current = ms;
      audioElRef.current = audioEl;
      objectUrlRef.current = url;
      pendingChunksRef.current = [];
      endOfStreamPendingRef.current = false;
    } else if (!useMse && analyserRef.current && audioCtxRef.current) {
      analyserRef.current.connect(audioCtxRef.current.destination);
      pcmLeftoverRef.current = null;
      nextStartTimeRef.current = 0;
    }

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
          setSpeechDetected(false);
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

        if (useMse && sourceOpenPromise) {
          await sourceOpenPromise;
          const sb = mediaSourceRef.current!.addSourceBuffer(MSE_MIME);
          sourceBufferRef.current = sb;

          function drain() {
            const s = sourceBufferRef.current;
            const ms2 = mediaSourceRef.current;
            if (!s || s.updating) return;
            if (pendingChunksRef.current.length > 0) {
              s.appendBuffer(pendingChunksRef.current.shift()!);
            } else if (endOfStreamPendingRef.current && ms2?.readyState === "open") {
              ms2.endOfStream();
              endOfStreamPendingRef.current = false;
            }
          }

          drainFnRef.current = drain;
          sb.addEventListener("updateend", drain);

          if (audioElRef.current) {
            audioElRef.current.onended = () => setBatchState("idle");
            audioElRef.current.onerror = () => setBatchState("idle");
          }
        }

        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        const formData = new FormData();
        formData.append("audio", blob, `recording.${ext}`);
        formData.append("personaId", persona!.id);
        formData.append("history", JSON.stringify(messagesRef.current));
        formData.append("ttsModel", settingsRef.current.ttsModel);
        formData.append("gptModel", settingsRef.current.gptModel);
        formData.append("audioFormat", useMse ? "opus" : "pcm");

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

              case "audio_chunk": {
                const raw = atob(data.data);
                if (useMse) {
                  const bytes = new Uint8Array(raw.length);
                  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
                  pendingChunksRef.current.push(bytes.buffer as ArrayBuffer);
                  drainFnRef.current?.();
                } else {
                  // PCM path: 24 kHz, 16-bit signed little-endian, mono.
                  let pcm = raw;
                  if (pcmLeftoverRef.current !== null) {
                    pcm = String.fromCharCode(pcmLeftoverRef.current) + pcm;
                    pcmLeftoverRef.current = null;
                  }
                  if (pcm.length % 2 !== 0) {
                    pcmLeftoverRef.current = pcm.charCodeAt(pcm.length - 1);
                    pcm = pcm.slice(0, -1);
                  }
                  const sampleCount = pcm.length / 2;
                  if (sampleCount > 0) {
                    const ctx = audioCtxRef.current!;
                    const audioBuffer = ctx.createBuffer(1, sampleCount, 24000);
                    const ch = audioBuffer.getChannelData(0);
                    for (let i = 0; i < sampleCount; i++) {
                      const lo = pcm.charCodeAt(i * 2);
                      const hi = pcm.charCodeAt(i * 2 + 1);
                      let s = (hi << 8) | lo;
                      if (s >= 0x8000) s -= 0x10000;
                      ch[i] = s / 32768;
                    }
                    const source = ctx.createBufferSource();
                    source.buffer = audioBuffer;
                    source.connect(analyserRef.current ?? ctx.destination);
                    const startAt = Math.max(ctx.currentTime, nextStartTimeRef.current);
                    source.start(startAt);
                    nextStartTimeRef.current = startAt + audioBuffer.duration;
                  }
                }
                break;
              }

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

                if (useMse) {
                  endOfStreamPendingRef.current = true;
                  drainFnRef.current?.();
                  setBatchState("playing");
                } else {
                  const ctx = audioCtxRef.current;
                  setBatchState(ctx && nextStartTimeRef.current > ctx.currentTime ? "playing" : "idle");
                }
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
  }, [persona, stopVad]);

  // Internal: start recording a new turn using the existing session stream.
  const startRecordingTurn = useCallback(() => {
    if (!conversationActiveRef.current || !sessionStreamRef.current || batchState !== "idle") return;

    const stream = sessionStreamRef.current;

    speechDetectedRef.current = false;
    silenceSinceRef.current = null;
    vadActiveRef.current = true;
    setSpeechDetected(false);
    setErrorMessage(null);
    // Re-enable mic tracks for this recording turn (were muted during processing/playback)
    sessionStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = true; });

    // ScriptProcessorNode receives PCM frames directly from the audio rendering pipeline.
    // iOS Safari ignores MediaRecorder timeslice AND has a bug where getFloatTimeDomainData
    // returns zeros for MediaStreamSourceNode — onaudioprocess is unaffected by both.
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const scriptProcessor = ctx.createScriptProcessor(2048, 1, 1);
    const micSource = ctx.createMediaStreamSource(stream);
    // silentGain(0) → destination: iOS WebKit won't process nodes without a destination path
    const silentGain = ctx.createGain();
    silentGain.gain.value = 0;
    micSource.connect(scriptProcessor);
    scriptProcessor.connect(silentGain);
    silentGain.connect(ctx.destination);
    scriptProcessorRef.current = scriptProcessor;
    micSourceRef.current = micSource;

    scriptProcessor.onaudioprocess = (event) => {
      if (!vadActiveRef.current) return;
      const input = event.inputBuffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
      const rms = Math.sqrt(sum / input.length);

      if (rms >= SPEECH_THRESHOLD) {
        if (!speechDetectedRef.current) {
          speechDetectedRef.current = true;
          setSpeechDetected(true);
        }
        silenceSinceRef.current = null;
      } else if (rms < SILENCE_THRESHOLD && speechDetectedRef.current) {
        if (silenceSinceRef.current === null) {
          silenceSinceRef.current = Date.now();
        } else if (Date.now() - silenceSinceRef.current >= END_OF_SPEECH_MS) {
          stopAndProcessInternal();
        }
      }
    };

    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.start();
    setBatchState("recording");
  }, [batchState, stopAndProcessInternal]);

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

    if (audioElRef.current) audioElRef.current.pause();

    if (sourceBufferRef.current && drainFnRef.current) {
      sourceBufferRef.current.removeEventListener("updateend", drainFnRef.current);
    }
    if (audioElRef.current) {
      audioElRef.current.onended = null;
      audioElRef.current.onerror = null;
      audioElRef.current.src = "";
    }
    if (mediaSourceRef.current?.readyState === "open") {
      try { mediaSourceRef.current.endOfStream(); } catch { /* already closed */ }
    }
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    mediaSourceRef.current = null;
    sourceBufferRef.current = null;
    audioElRef.current = null;
    objectUrlRef.current = null;
    pendingChunksRef.current = [];
    endOfStreamPendingRef.current = false;
    drainFnRef.current = null;
    useMseRef.current = false;
    pcmLeftoverRef.current = null;
    nextStartTimeRef.current = 0;

    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    analyserRef.current = null;

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    setSpeechDetected(false);
    setPlaybackVolume(0);
    setBatchState("idle");
  }, [stopVad]);

  // RAF loop: reads analyser for volume glow while in "playing" state
  useEffect(() => {
    if (batchState !== "playing") {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      setPlaybackVolume(0);
      return;
    }
    const analyser = analyserRef.current;
    const ctx = audioCtxRef.current;
    if (!analyser || !ctx) {
      setBatchState("idle");
      return;
    }

    const buf = new Uint8Array(analyser.frequencyBinCount);

    function tick() {
      analyser!.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      setPlaybackVolume(Math.min(Math.sqrt(sum / buf.length) * 5, 1));

      if (!useMseRef.current && ctx!.currentTime >= nextStartTimeRef.current) {
        setBatchState("idle");
        return;
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [batchState]);

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

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    if (sourceBufferRef.current && drainFnRef.current) {
      sourceBufferRef.current.removeEventListener("updateend", drainFnRef.current);
    }
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current.onended = null;
      audioElRef.current.onerror = null;
      audioElRef.current.src = "";
    }
    if (mediaSourceRef.current?.readyState === "open") {
      try { mediaSourceRef.current.endOfStream(); } catch { /* already closed */ }
    }
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    mediaSourceRef.current = null;
    sourceBufferRef.current = null;
    audioElRef.current = null;
    objectUrlRef.current = null;
    pendingChunksRef.current = [];
    pcmLeftoverRef.current = null;
    endOfStreamPendingRef.current = false;
    drainFnRef.current = null;
    useMseRef.current = false;

    sessionStreamRef.current?.getTracks().forEach((t) => t.stop());
    sessionStreamRef.current = null;

    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.ondataavailable = null;
      recorder.stop();
    }
    recorderRef.current = null;
    chunksRef.current = [];
    nextStartTimeRef.current = 0;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    analyserRef.current = null;
    setMicReady(false);
    setMessages([]);
    setCurrentTranscript("");
    setCurrentReply("");
    setErrorMessage(null);
    setSpeechDetected(false);
    setPlaybackVolume(0);
    setBatchState("idle");
  }, [stopVad]);

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
