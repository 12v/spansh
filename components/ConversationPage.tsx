"use client";

import { useCallback, useRef, useState } from "react";
import type { Persona } from "@/lib/personas/types";
import { useRealtimeConnection } from "@/lib/realtime/useRealtimeConnection";
import { useAudioRecorder } from "@/lib/realtime/useAudioRecorder";
import { PersonaSelector } from "./PersonaSelector";
import { PushToTalkButton } from "./PushToTalkButton";
import { ConnectionStatus } from "./ConnectionStatus";

interface ConversationPageProps {
  personas: Persona[];
}

export function ConversationPage({ personas }: ConversationPageProps) {
  const [selectedPersona, setSelectedPersona] = useState<Persona | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const { state, connect, disconnect, replaceAudioTrack } = useRealtimeConnection({
    onTrack: (event) => {
      if (audioRef.current && event.streams[0]) {
        audioRef.current.srcObject = event.streams[0];
      }
    },
    onError: (err) => {
      setErrorMessage(err.message);
    },
    onStateChange: (s) => {
      if (s !== "error") setErrorMessage(null);
    },
  });

  const { isRecording, startRecording, stopRecording } = useAudioRecorder(
    replaceAudioTrack,
    {
      onError: (err) => setErrorMessage(err.message),
    }
  );

  const handlePersonaSelect = useCallback(
    async (persona: Persona) => {
      setSelectedPersona(persona);
      setErrorMessage(null);
      await connect(persona.id);
    },
    [connect]
  );

  const handleReset = useCallback(() => {
    stopRecording();
    disconnect();
    setSelectedPersona(null);
    setErrorMessage(null);
    if (audioRef.current) {
      audioRef.current.srcObject = null;
    }
  }, [stopRecording, disconnect]);

  const isConnected = state === "connected";
  const isConnecting = state === "connecting";

  return (
    <main className="min-h-screen bg-gray-950 flex flex-col items-center justify-between px-4 py-8 sm:py-12">
      {/* Header */}
      <div className="w-full max-w-2xl flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">spansh</h1>
          <p className="text-xs text-gray-500 mt-0.5">Práctica de conversación en español</p>
        </div>
        {selectedPersona && (
          <button
            onClick={handleReset}
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            Cambiar personaje
          </button>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center w-full py-8 gap-8">
        {!selectedPersona ? (
          <PersonaSelector
            personas={personas}
            onSelect={handlePersonaSelect}
            loading={isConnecting}
          />
        ) : (
          <div className="flex flex-col items-center gap-6">
            {/* Selected persona info */}
            <div className="text-center">
              <p className="text-gray-400 text-sm">Hablando con</p>
              <p className="text-white font-semibold text-xl mt-1">
                {selectedPersona.displayName}
              </p>
              <p className="text-gray-500 text-sm mt-1">{selectedPersona.accentRegion}</p>
            </div>

            {/* PTT Button */}
            <div className="flex flex-col items-center gap-4">
              <PushToTalkButton
                onPressStart={startRecording}
                onPressEnd={stopRecording}
                disabled={!isConnected}
                isRecording={isRecording}
              />
              <p className="text-xs text-gray-500 select-none">
                {isRecording
                  ? "Grabando... suelta para enviar"
                  : isConnected
                  ? "Mantén pulsado para hablar"
                  : isConnecting
                  ? "Conectando..."
                  : ""}
              </p>
            </div>
          </div>
        )}

        {/* Error message */}
        {errorMessage && (
          <div className="max-w-sm w-full rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">
            {errorMessage}
          </div>
        )}
      </div>

      {/* Footer: connection status */}
      <div className="w-full max-w-2xl flex justify-center">
        <ConnectionStatus state={state} />
      </div>

      {/* Hidden audio element for AI responses — captions not applicable for live AI speech */}
      <audio ref={audioRef} autoPlay playsInline className="hidden" />
    </main>
  );
}
