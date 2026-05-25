"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const MSE_MIME = 'audio/ogg; codecs="opus"';

function mseSupported(): boolean {
  return (
    typeof MediaSource !== "undefined" &&
    MediaSource.isTypeSupported(MSE_MIME)
  );
}

export function usePlayback(
  audioCtxRef: React.RefObject<AudioContext | null>,
  isPlaying: boolean,
  onPlaybackEnd: () => void
) {
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const [playbackVolume, setPlaybackVolume] = useState(0);

  // MSE refs
  const useMseRef = useRef(false);
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const pendingChunksRef = useRef<ArrayBuffer[]>([]);
  const endOfStreamPendingRef = useRef(false);
  const drainFnRef = useRef<(() => void) | null>(null);

  // PCM fallback refs (Safari: 24 kHz 16-bit mono PCM, scheduled synchronously)
  const pcmLeftoverRef = useRef<number | null>(null);
  const nextStartTimeRef = useRef(0);

  // Stable ref so RAF tick closure doesn't capture a stale onPlaybackEnd
  const onPlaybackEndRef = useRef(onPlaybackEnd);
  onPlaybackEndRef.current = onPlaybackEnd;

  // RAF loop: reads analyser for volume glow while playing
  useEffect(() => {
    if (!isPlaying) {
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
      onPlaybackEndRef.current();
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
        onPlaybackEndRef.current();
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
  }, [isPlaying]); // eslint-disable-line react-hooks/exhaustive-deps

  // Step 1: called at the start of each processing turn — sets up MSE or PCM path
  const preparePlayback = useCallback((): {
    useMse: boolean;
    sourceOpenPromise: Promise<void> | null;
  } => {
    const ctx = audioCtxRef.current;
    const useMse = mseSupported();
    useMseRef.current = useMse;

    if (ctx) {
      analyserRef.current = ctx.createAnalyser();
      analyserRef.current.fftSize = 256;
    }

    if (useMse && ctx && analyserRef.current) {
      const ms = new MediaSource();
      const url = URL.createObjectURL(ms);
      const audioEl = new Audio();
      audioEl.src = url;

      const sourceOpenPromise = new Promise<void>((resolve) => {
        ms.addEventListener("sourceopen", () => resolve(), { once: true });
      });

      const mediaElSrc = ctx.createMediaElementSource(audioEl);
      mediaElSrc.connect(analyserRef.current);
      analyserRef.current.connect(ctx.destination);

      audioEl.play().catch(() => {});

      mediaSourceRef.current = ms;
      audioElRef.current = audioEl;
      objectUrlRef.current = url;
      pendingChunksRef.current = [];
      endOfStreamPendingRef.current = false;

      return { useMse: true, sourceOpenPromise };
    } else if (!useMse && analyserRef.current && ctx) {
      analyserRef.current.connect(ctx.destination);
      pcmLeftoverRef.current = null;
      nextStartTimeRef.current = 0;
    }

    return { useMse, sourceOpenPromise: null };
  }, [audioCtxRef]);

  // Step 2 (MSE only): called after sourceOpenPromise resolves
  const initSourceBuffer = useCallback((onEnd: () => void) => {
    const ms = mediaSourceRef.current;
    if (!ms) return;

    const sb = ms.addSourceBuffer(MSE_MIME);
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

    const audioEl = audioElRef.current;
    if (audioEl) {
      audioEl.onended = onEnd;
      audioEl.onerror = onEnd;
    }
  }, []);

  // Step 3: called for each audio_chunk SSE event
  const handleAudioChunk = useCallback((base64Data: string) => {
    const raw = atob(base64Data);
    if (useMseRef.current) {
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      pendingChunksRef.current.push(bytes.buffer as ArrayBuffer);
      drainFnRef.current?.();
    } else {
      // PCM path: 24 kHz, 16-bit signed little-endian, mono
      const ctx = audioCtxRef.current;
      if (!ctx) return;
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
  }, [audioCtxRef]);

  // Step 4: called on the "done" SSE event — returns the next batchState
  const finalizeAudioStream = useCallback((): "playing" | "idle" => {
    const ctx = audioCtxRef.current;
    if (useMseRef.current) {
      endOfStreamPendingRef.current = true;
      drainFnRef.current?.();
      return "playing";
    }
    return ctx && nextStartTimeRef.current > ctx.currentTime ? "playing" : "idle";
  }, [audioCtxRef]);

  // Full teardown — call from stopConversation and reset
  const cleanupPlayback = useCallback(() => {
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
    endOfStreamPendingRef.current = false;
    drainFnRef.current = null;
    useMseRef.current = false;
    pcmLeftoverRef.current = null;
    nextStartTimeRef.current = 0;
    analyserRef.current = null;
    setPlaybackVolume(0);
  }, []);

  return {
    playbackVolume,
    preparePlayback,
    initSourceBuffer,
    handleAudioChunk,
    finalizeAudioStream,
    cleanupPlayback,
  };
}
