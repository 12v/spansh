"use client";

import { useCallback, useRef, useState } from "react";
import type { Persona } from "@/lib/personas/types";
import { useBatchConversation } from "@/lib/batch/useBatchConversation";
import { PersonaSelector } from "./PersonaSelector";
import { PushToTalkButton } from "./PushToTalkButton";

const SHORT_HOLD_MS = 400;

interface ConversationPageProps {
  personas: Persona[];
}

export function ConversationPage({ personas }: ConversationPageProps) {
  const [selectedPersona, setSelectedPersona] = useState<Persona | null>(null);
  const [showHoldHint, setShowHoldHint] = useState(false);
  const holdHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressStartRef = useRef(0);

  const {
    batchState,
    micReady,
    messages,
    errorMessage,
    currentTranscript,
    currentReply,
    prepareMic,
    startRecording,
    cancelRecording,
    stopAndProcess,
    reset,
  } = useBatchConversation(selectedPersona);

  const handlePersonaSelect = useCallback(
    async (persona: Persona) => {
      setSelectedPersona(persona);
      await prepareMic();
    },
    [prepareMic]
  );

  const handleReset = useCallback(() => {
    reset();
    setSelectedPersona(null);
    setShowHoldHint(false);
  }, [reset]);

  const handlePressStart = useCallback(() => {
    pressStartRef.current = Date.now();
    setShowHoldHint(false);
    if (holdHintTimerRef.current) clearTimeout(holdHintTimerRef.current);
    startRecording();
  }, [startRecording]);

  const handlePressEnd = useCallback(() => {
    const held = Date.now() - pressStartRef.current;
    if (held < SHORT_HOLD_MS) {
      cancelRecording();
      setShowHoldHint(true);
      holdHintTimerRef.current = setTimeout(() => setShowHoldHint(false), 2500);
    } else {
      stopAndProcess();
    }
  }, [cancelRecording, stopAndProcess]);

  const isRecording = batchState === "recording";
  const isProcessing = batchState === "processing";
  const isDisabled = isProcessing || !micReady;

  const statusText = showHoldHint
    ? "Mantén pulsado mientras hablas"
    : isRecording
    ? "Grabando... suelta para enviar"
    : isProcessing
    ? currentTranscript
      ? "Respondiendo..."
      : "Transcribiendo..."
    : batchState === "error"
    ? ""
    : !micReady
    ? "Solicitando micrófono..."
    : messages.length === 0
    ? "Mantén pulsado para hablar"
    : "Mantén pulsado para responder";

  // Show historical messages plus any in-flight exchange
  const showInFlight = isProcessing && (currentTranscript || currentReply);

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
              <p className="text-gray-500 text-sm mt-1">{selectedPersona.accentRegion}</p>
            </div>

            {/* Conversation history */}
            {(messages.length >= 2 || showInFlight) && (
              <div className="w-full flex flex-col gap-3">
                {/* Last completed exchange — dimmed when an in-flight exchange is visible */}
                {messages.length >= 2 && (() => {
                  const lastUser = messages[messages.length - 2];
                  const lastAssistant = messages[messages.length - 1];
                  const dim = showInFlight;
                  return (
                    <>
                      <div className={`self-end max-w-xs rounded-2xl bg-indigo-700 px-4 py-2.5 text-sm text-white transition-opacity ${dim ? "opacity-40" : ""}`}>
                        {lastUser.content}
                      </div>
                      <div className={`self-start max-w-xs rounded-2xl bg-gray-800 px-4 py-2.5 text-sm text-gray-100 transition-opacity ${dim ? "opacity-40" : ""}`}>
                        {lastAssistant.content}
                      </div>
                    </>
                  );
                })()}

                {/* In-flight exchange (while processing) */}
                {showInFlight && (
                  <>
                    {currentTranscript ? (
                      <div className="self-end max-w-xs rounded-2xl bg-indigo-700 px-4 py-2.5 text-sm text-white">
                        {currentTranscript}
                      </div>
                    ) : (
                      <div className="self-end max-w-xs rounded-2xl bg-indigo-700/50 px-4 py-2.5 text-sm text-indigo-300 animate-pulse">
                        …
                      </div>
                    )}
                    {currentReply && (
                      <div className="self-start max-w-xs rounded-2xl bg-gray-800 px-4 py-2.5 text-sm text-gray-100">
                        {currentReply}
                        <span className="inline-block w-0.5 h-3.5 bg-gray-400 ml-0.5 animate-pulse align-middle" />
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* PTT Button */}
            <div className="flex flex-col items-center gap-4">
              <PushToTalkButton
                onPressStart={handlePressStart}
                onPressEnd={handlePressEnd}
                disabled={isDisabled}
                isRecording={isRecording}
              />
              <p className={`text-xs select-none min-h-4 transition-colors ${showHoldHint ? "text-amber-400 animate-pulse" : "text-gray-500"}`}>
                {statusText}
              </p>
            </div>
          </div>
        )}

        {/* Error */}
        {errorMessage && (
          <div className="max-w-sm w-full rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">
            {errorMessage}
            {batchState === "error" && (
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

      {/* Footer */}
      <div className="w-full max-w-2xl flex justify-center">
        <p className="text-xs text-gray-600">
          {messages.length > 0
            ? `${Math.ceil(messages.length / 2)} intercambio${messages.length > 2 ? "s" : ""}`
            : ""}
        </p>
      </div>

    </main>
  );
}
