"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Settings } from "lucide-react";
import type { Persona } from "@/lib/personas/types";
import { useRealtimeConversation } from "@/lib/realtime/useRealtimeConversation";
import { useSettings } from "@/lib/settings/useSettings";
import { SettingsPanel } from "./SettingsPanel";
import { PersonaSelector } from "./PersonaSelector";
import { ConversationButton } from "./ConversationButton";
import { cn } from "@/lib/utils";

interface ConversationPageProps {
  personas: Persona[];
}

export function ConversationPage({ personas }: ConversationPageProps) {
  const [selectedPersona, setSelectedPersona] = useState<Persona | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const { settings, updateSetting } = useSettings();

  const {
    batchState,
    messages,
    errorMessage,
    currentTranscript,
    currentReply,
    playbackVolume,
    conversationActive,
    speechDetected,
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

  const isConnecting = batchState === "connecting";
  const isRecording = batchState === "recording";
  const isProcessing = batchState === "processing";
  const isPlaying = batchState === "playing";

  const statusText = isConnecting
    ? "Conectando..."
    : conversationActive
    ? isRecording
      ? speechDetected
        ? "Hablando..."
        : "Escuchando..."
      : isProcessing
      ? "Respondiendo..."
      : isPlaying
      ? "Reproduciendo..."
      : "Escuchando..."
    : batchState === "error"
    ? ""
    : messages.length === 0
    ? "Pulsa para iniciar"
    : "Conversación pausada";

  // Auto-scroll to bottom as new content arrives
  const scrollAnchorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, currentTranscript, currentReply, speechDetected]);

  // Pulsing placeholder while the user is actively speaking (transcription not yet ready)
  const showUserSpeaking = isRecording && speechDetected && !currentTranscript;

  // Any in-flight content to display below the history
  const hasInFlight =
    showUserSpeaking ||
    currentTranscript ||
    currentReply ||
    ((isProcessing || isPlaying) && !currentTranscript);

  return (
    <main className="min-h-screen bg-gray-950 flex flex-col items-center justify-between px-4 py-8 sm:py-12">
      {/* Header */}
      <div className="w-full max-w-2xl flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">spansh</h1>
          <p className="text-xs text-gray-500 mt-0.5">Práctica de conversación en español</p>
        </div>
        <div className="flex items-center gap-3">
          {selectedPersona && (
            <button
              onClick={handleReset}
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              Cambiar personaje
            </button>
          )}
          <button
            onClick={() => setSettingsOpen(true)}
            className="text-gray-500 hover:text-white transition-colors"
            aria-label="Ajustes"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </div>

      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          onUpdate={updateSetting}
          onClose={() => setSettingsOpen(false)}
        />
      )}

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
              <p className="text-gray-500 text-sm mt-1">{selectedPersona.speakingStyle} · {selectedPersona.accentRegion}</p>
            </div>

            {/* Full scrollable transcript */}
            {(messages.length > 0 || hasInFlight) && (
              <div className="w-full flex flex-col gap-2 max-h-72 overflow-y-auto">
                {/* All completed exchanges */}
                {messages.map((msg, i) =>
                  msg.role === "assistant" && settings.listeningMode ? null : (
                    <div
                      key={i}
                      className={cn(
                        "max-w-xs rounded-2xl px-4 py-2.5 text-sm",
                        msg.role === "user"
                          ? "self-end bg-indigo-700 text-white"
                          : "self-start bg-gray-800 text-gray-100"
                      )}
                    >
                      {msg.content}
                    </div>
                  )
                )}

                {/* User speaking — pulsing placeholder until transcription arrives */}
                {showUserSpeaking && (
                  <div className="self-end max-w-xs rounded-2xl bg-indigo-700/50 px-4 py-2.5 text-sm text-indigo-300 animate-pulse">
                    …
                  </div>
                )}

                {/* User transcription (appears once speech is processed) */}
                {currentTranscript && (
                  <div className="self-end max-w-xs rounded-2xl bg-indigo-700 px-4 py-2.5 text-sm text-white">
                    {currentTranscript}
                  </div>
                )}

                {/* Waiting for transcription placeholder */}
                {(isProcessing || isPlaying) && !currentTranscript && (
                  <div className="self-end max-w-xs rounded-2xl bg-indigo-700/50 px-4 py-2.5 text-sm text-indigo-300 animate-pulse">
                    …
                  </div>
                )}

                {/* Streaming assistant reply */}
                {!settings.listeningMode && currentReply && (
                  <div className="self-start max-w-xs rounded-2xl bg-gray-800 px-4 py-2.5 text-sm text-gray-100">
                    {currentReply}
                    <span className="inline-block w-0.5 h-3.5 bg-gray-400 ml-0.5 animate-pulse align-middle" />
                  </div>
                )}

                {/* Scroll anchor */}
                <div ref={scrollAnchorRef} />
              </div>
            )}

            {/* Conversation Button */}
            <div className="flex flex-col items-center gap-4">
              <ConversationButton
                conversationActive={conversationActive}
                batchState={batchState}
                speechDetected={speechDetected}
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
