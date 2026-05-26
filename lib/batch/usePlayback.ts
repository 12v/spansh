"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const FRAMES_PER_DECODE = 4;

// Returns the byte length of the MP3 frame starting at buf[offset], or null if not a valid header.
function mp3FrameLength(buf: Uint8Array, offset: number): number | null {
  if (offset + 4 > buf.length) return null;
  if (buf[offset] !== 0xFF || (buf[offset + 1] & 0xE0) !== 0xE0) return null;

  const b1 = buf[offset + 1];
  const b2 = buf[offset + 2];

  const version = (b1 >> 3) & 3; // 3=MPEG1, 2=MPEG2, 0=MPEG2.5
  const layer   = (b1 >> 1) & 3; // 3=Layer1, 2=Layer2, 1=Layer3
  const brIdx   = (b2 >> 4) & 0xF;
  const srIdx   = (b2 >> 2) & 3;
  const padding = (b2 >> 1) & 1;

  if (layer === 0 || brIdx === 0 || brIdx === 15 || srIdx === 3) return null;

  const br1  = [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320,0];
  const br23 = [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160,0];
  const bitrate = (version === 3 ? br1[brIdx] : br23[brIdx]) * 1000;

  const sr1  = [44100,48000,32000,0];
  const sr2  = [22050,24000,16000,0];
  const sr25 = [11025,12000,8000,0];
  const sampleRate = version === 3 ? sr1[srIdx] : version === 2 ? sr2[srIdx] : sr25[srIdx];

  if (!bitrate || !sampleRate) return null;

  // Layer 1 has a different frame size formula
  if (layer === 3) return Math.floor(12 * bitrate / sampleRate + padding) * 4;
  return Math.floor(144 * bitrate / sampleRate) + padding;
}

export function usePlayback(
  audioCtxRef: React.RefObject<AudioContext | null>,
  isPlaying: boolean,
  onPlaybackEnd: () => void
) {
  const analyserRef       = useRef<AnalyserNode | null>(null);
  const rafRef            = useRef<number | null>(null);
  const [playbackVolume, setPlaybackVolume] = useState(0);

  const nextStartTimeRef  = useRef(0);
  const byteBufferRef     = useRef<Uint8Array>(new Uint8Array(0));
  const pendingFramesRef  = useRef<Uint8Array[]>([]);
  const decodeQueueRef    = useRef<Promise<void>>(Promise.resolve());
  const pendingDecodesRef = useRef(0);

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

      if (pendingDecodesRef.current === 0 && ctx!.currentTime >= nextStartTimeRef.current) {
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

  // Chains decoded audio onto a sequential promise queue so frames play in order.
  const decodeAndSchedule = useCallback((frames: Uint8Array[]) => {
    if (!frames.length) return;
    pendingDecodesRef.current++;

    const total = frames.reduce((n, f) => n + f.length, 0);
    const combined = new Uint8Array(total);
    let off = 0;
    for (const f of frames) { combined.set(f, off); off += f.length; }

    decodeQueueRef.current = decodeQueueRef.current.then(async () => {
      const ctx = audioCtxRef.current;
      if (!ctx) { pendingDecodesRef.current--; return; }
      try {
        const decoded = await ctx.decodeAudioData(combined.buffer.slice(0, combined.byteLength));
        const source = ctx.createBufferSource();
        source.buffer = decoded;
        source.connect(analyserRef.current ?? ctx.destination);
        const startAt = Math.max(ctx.currentTime, nextStartTimeRef.current);
        source.start(startAt);
        nextStartTimeRef.current = startAt + decoded.duration;
      } catch {
        // ignore individual batch decode errors
      } finally {
        pendingDecodesRef.current--;
      }
    }).catch(() => { pendingDecodesRef.current--; });
  }, [audioCtxRef]);

  // Step 1: called at the start of each processing turn
  const preparePlayback = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (ctx) {
      analyserRef.current = ctx.createAnalyser();
      analyserRef.current.fftSize = 256;
      analyserRef.current.connect(ctx.destination);
    }
    byteBufferRef.current = new Uint8Array(0);
    pendingFramesRef.current = [];
    decodeQueueRef.current = Promise.resolve();
    pendingDecodesRef.current = 0;
    nextStartTimeRef.current = 0;
  }, [audioCtxRef]);

  // Step 2: called for each audio_chunk SSE event
  const handleAudioChunk = useCallback((base64Data: string) => {
    const raw = atob(base64Data);
    const incoming = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) incoming[i] = raw.charCodeAt(i);

    // Append to rolling buffer
    const prev = byteBufferRef.current;
    const next = new Uint8Array(prev.length + incoming.length);
    next.set(prev);
    next.set(incoming, prev.length);
    byteBufferRef.current = next;

    // Extract and batch complete frames
    let pos = 0;
    const buf = byteBufferRef.current;
    while (pos < buf.length) {
      if (buf[pos] !== 0xFF || pos + 1 >= buf.length || (buf[pos + 1] & 0xE0) !== 0xE0) {
        pos++;
        continue;
      }
      const frameLen = mp3FrameLength(buf, pos);
      if (frameLen === null) { pos++; continue; }
      if (pos + frameLen > buf.length) break;

      pendingFramesRef.current.push(buf.slice(pos, pos + frameLen));
      pos += frameLen;

      if (pendingFramesRef.current.length >= FRAMES_PER_DECODE) {
        decodeAndSchedule(pendingFramesRef.current.splice(0));
      }
    }
    byteBufferRef.current = buf.slice(pos);
  }, [decodeAndSchedule]);

  // Step 3: called on the "done" SSE event — flushes remaining frames
  const finalizeAudioStream = useCallback((): "playing" | "idle" => {
    if (pendingFramesRef.current.length > 0) {
      decodeAndSchedule(pendingFramesRef.current.splice(0));
    }
    const ctx = audioCtxRef.current;
    const hasWork = pendingDecodesRef.current > 0 || nextStartTimeRef.current > (ctx?.currentTime ?? 0);
    return hasWork ? "playing" : "idle";
  }, [audioCtxRef, decodeAndSchedule]);

  // Full teardown
  const cleanupPlayback = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    decodeQueueRef.current = Promise.resolve();
    pendingDecodesRef.current = 0;
    byteBufferRef.current = new Uint8Array(0);
    pendingFramesRef.current = [];
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
