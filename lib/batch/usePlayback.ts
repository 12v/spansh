"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function usePlayback(
  audioCtxRef: React.RefObject<AudioContext | null>,
  isPlaying: boolean,
  onPlaybackEnd: () => void
) {
  const analyserRef      = useRef<AnalyserNode | null>(null);
  const rafRef           = useRef<number | null>(null);
  const [playbackVolume, setPlaybackVolume] = useState(0);

  const nextStartTimeRef = useRef(0);
  const pcmLeftoverRef   = useRef<number | null>(null); // unpaired byte carried across chunks

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

      if (ctx!.currentTime >= nextStartTimeRef.current) {
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

  // Step 1: called at the start of each processing turn
  const preparePlayback = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (ctx) {
      analyserRef.current = ctx.createAnalyser();
      analyserRef.current.fftSize = 256;
      analyserRef.current.connect(ctx.destination);
    }
    pcmLeftoverRef.current = null;
    nextStartTimeRef.current = 0;
  }, [audioCtxRef]);

  // Step 2: called for each audio_chunk SSE event
  // Server sends 24 kHz 16-bit signed little-endian mono PCM.
  const handleAudioChunk = useCallback((base64Data: string) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    let raw = atob(base64Data);

    // Re-attach any unpaired byte left over from the previous chunk.
    if (pcmLeftoverRef.current !== null) {
      raw = String.fromCharCode(pcmLeftoverRef.current) + raw;
      pcmLeftoverRef.current = null;
    }
    // Save a trailing odd byte for next time.
    if (raw.length % 2 !== 0) {
      pcmLeftoverRef.current = raw.charCodeAt(raw.length - 1);
      raw = raw.slice(0, -1);
    }

    const sampleCount = raw.length / 2;
    if (sampleCount === 0) return;

    const audioBuffer = ctx.createBuffer(1, sampleCount, 24000);
    const ch = audioBuffer.getChannelData(0);
    for (let i = 0; i < sampleCount; i++) {
      const lo = raw.charCodeAt(i * 2);
      const hi = raw.charCodeAt(i * 2 + 1);
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
  }, [audioCtxRef]);

  // Step 3: called on the "done" SSE event
  const finalizeAudioStream = useCallback((): "playing" | "idle" => {
    const ctx = audioCtxRef.current;
    return ctx && nextStartTimeRef.current > ctx.currentTime ? "playing" : "idle";
  }, [audioCtxRef]);

  // Full teardown
  const cleanupPlayback = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    pcmLeftoverRef.current = null;
    nextStartTimeRef.current = 0;
    analyserRef.current = null;
    setPlaybackVolume(0);
  }, []);

  return {
    playbackVolume,
    preparePlayback,
    handleAudioChunk,
    finalizeAudioStream,
    cleanupPlayback,
  };
}
