"use client";

import { useCallback, useRef, useState } from "react";

interface UseAudioRecorderOptions {
  onStartRecording?: () => void;
  onStopRecording?: () => void;
  onError?: (error: Error) => void;
}

export function useAudioRecorder(
  replaceTrack: (track: MediaStreamTrack | null) => void,
  options: UseAudioRecorderOptions = {}
) {
  const streamRef = useRef<MediaStream | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [isRecording, setIsRecording] = useState(false);

  const startRecording = useCallback(async () => {
    if (streamRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 24000,
        },
      });
      streamRef.current = stream;
      const track = stream.getAudioTracks()[0];
      replaceTrack(track);
      setIsRecording(true);
      optionsRef.current.onStartRecording?.();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      optionsRef.current.onError?.(error);
    }
  }, [replaceTrack]);

  const stopRecording = useCallback(() => {
    if (!streamRef.current) return;
    streamRef.current.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    replaceTrack(null);
    setIsRecording(false);
    optionsRef.current.onStopRecording?.();
  }, [replaceTrack]);

  return { isRecording, startRecording, stopRecording };
}
