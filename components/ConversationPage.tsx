"use client";

import { useCallback, useState } from "react";
import type { Persona } from "@/lib/personas/types";
import { useRealtimeConversation } from "@/lib/realtime/useRealtimeConversation";
import { PersonaSelector } from "./PersonaSelector";
import { ConversationButton } from "./ConversationButton";

interface ConversationPageProps {
  personas: Persona[];
}

export function ConversationPage({ personas }: ConversationPageProps) {
  const [selectedPersona, setSelectedPersona] = useState<Persona | null>(null);

  const {
    connectionState,
    conversationActive,
    speechDetected,
    isModelSpeaking,
    playbackVolume,
    errorMessage,
    startConversation,
    stopConversation,
    reset,
  } = useRealtimeConversation(selectedPersona);

  const handlePersonaSelect = useCallback((persona: Persona) => {
    setSelectedPersona(persona);
  }, []);

  const handleReset = useCallback(() => {
    reset();
    setSelectedPersona(null);
  }, [reset]);

  const handleConversationToggle = useCallback(() => {
    if (conversationActive) {
      stopConversation();
    } else {
      startConversation();
    }
  }, [conversationActive, startConversation, stopConversation]);

  const statusText =
    connectionState === "connecting"
      ? "Conectando..."
      : connectionState === "error"
      ? ""
      : conversationActive
      ? speechDetected
        ? "Hablando..."
        : isModelSpeaking
        ? "Reproduciendo..."
        : "Escuchando..."
      : selectedPersona
      ? "Pulsa para continuar"
      : "Pulsa para iniciar";

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
          <PersonaSelector personas={personas} onSelect={handlePersonaSelect} loading={false} />
        ) : (
          <div className="flex flex-col items-center gap-6 w-full max-w-lg">
            {/* Persona info */}
            <div className="text-center">
              <p className="text-gray-400 text-sm">Hablando con</p>
              <p className="text-white font-semibold text-xl mt-1">{selectedPersona.displayName}</p>
              <p className="text-gray-500 text-sm mt-1">
                {selectedPersona.speakingStyle} · {selectedPersona.accentRegion}
              </p>
            </div>

            {/* Conversation Button */}
            <div className="flex flex-col items-center gap-4">
              <ConversationButton
                conversationActive={conversationActive}
                connectionState={connectionState}
                speechDetected={speechDetected}
                isModelSpeaking={isModelSpeaking}
                playbackVolume={playbackVolume}
                onToggle={handleConversationToggle}
              />
              <p className="text-xs select-none min-h-4 text-gray-500">
                {statusText}
              </p>
            </div>

            {/* Error */}
            {errorMessage && (
              <div className="w-full rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">
                {errorMessage}
                {connectionState === "error" && (
                  <button
                    onClick={() => reset()}
                    className="ml-3 underline text-red-400 hover:text-red-200"
                  >
                    Reintentar
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
