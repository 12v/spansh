"use client";

import { useCallback, useRef, useState } from "react";

// VAD via ScriptProcessorNode.onaudioprocess — receives PCM frames directly from the
// audio rendering pipeline. Works on iOS Safari where getFloatTimeDomainData returns
// zeros for MediaStreamSourceNode (WebKit bug #225564) and where MediaRecorder timeslice
// is ignored (ondataavailable only fires on stop).
const SPEECH_THRESHOLD = 0.02;
const SILENCE_THRESHOLD = 0.01;
const END_OF_SPEECH_MS = 1500;

export function useVad(
  audioCtxRef: React.RefObject<AudioContext | null>,
  onEndOfSpeech: () => void
) {
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const speechDetectedRef = useRef(false);
  const silenceSinceRef = useRef<number | null>(null);
  const vadActiveRef = useRef(false);
  const [speechDetected, setSpeechDetected] = useState(false);

  // Stable ref so startVad doesn't capture a stale onEndOfSpeech
  const onEndOfSpeechRef = useRef(onEndOfSpeech);
  onEndOfSpeechRef.current = onEndOfSpeech;

  const stopVad = useCallback(() => {
    vadActiveRef.current = false;
    speechDetectedRef.current = false;
    silenceSinceRef.current = null;
    setSpeechDetected(false);
    scriptProcessorRef.current?.disconnect();
    scriptProcessorRef.current = null;
    micSourceRef.current?.disconnect();
    micSourceRef.current = null;
  }, []);

  // Returns false if AudioContext is not ready (caller should abort the turn)
  const startVad = useCallback((stream: MediaStream): boolean => {
    const ctx = audioCtxRef.current;
    if (!ctx) return false;

    speechDetectedRef.current = false;
    silenceSinceRef.current = null;
    vadActiveRef.current = true;
    setSpeechDetected(false);

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
          onEndOfSpeechRef.current();
        }
      }
    };

    return true;
  }, [audioCtxRef]);

  return { speechDetected, speechDetectedRef, startVad, stopVad };
}
