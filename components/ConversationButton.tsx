"use client";

import { Mic } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConnectionState } from "@/lib/realtime/useRealtimeConversation";

interface ConversationButtonProps {
  conversationActive: boolean;
  connectionState: ConnectionState;
  speechDetected: boolean;
  isModelSpeaking: boolean;
  playbackVolume: number;
  onToggle: () => void;
  disabled?: boolean;
}

export function ConversationButton({
  conversationActive,
  connectionState,
  speechDetected,
  isModelSpeaking,
  playbackVolume,
  onToggle,
  disabled = false,
}: ConversationButtonProps) {
  const isConnecting  = connectionState === "connecting";
  const isListening   = conversationActive && !speechDetected && !isModelSpeaking;
  const isSpeaking    = conversationActive && speechDetected;
  const isPlaying     = conversationActive && isModelSpeaking;

  const style = {
    touchAction: "none",
    userSelect: "none",
    WebkitUserSelect: "none",
    WebkitTouchCallout: "none",
    ...(isPlaying
      ? {
          boxShadow: `0 0 0 ${Math.round(4 + 20 * playbackVolume)}px rgba(99,102,241,${(0.15 + 0.45 * playbackVolume).toFixed(2)})`,
        }
      : {}),
  } as React.CSSProperties;

  return (
    <button
      onClick={onToggle}
      disabled={disabled || isConnecting}
      style={style}
      className={cn(
        "relative flex items-center justify-center",
        "w-24 h-24 rounded-full",
        "focus:outline-none",
        !isPlaying && "transition-all duration-200",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        isSpeaking  && "bg-red-500 shadow-[0_0_0_8px_rgba(239,68,68,0.3)] animate-pulse",
        isListening && "bg-emerald-600 shadow-[0_0_0_6px_rgba(16,185,129,0.25)] animate-[pulse_2s_ease-in-out_infinite]",
        isConnecting && "bg-gray-700",
        isPlaying    && "bg-indigo-600",
        !conversationActive && !isConnecting && "bg-indigo-600 hover:bg-indigo-500 shadow-[0_0_0_4px_rgba(99,102,241,0.3)] hover:shadow-[0_0_0_8px_rgba(99,102,241,0.25)]"
      )}
      aria-label={conversationActive ? "Detener conversación" : "Iniciar conversación"}
    >
      {isConnecting && (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        </span>
      )}
      <Mic
        className={cn("w-10 h-10 text-white", isConnecting && "opacity-30")}
        strokeWidth={1.75}
      />
    </button>
  );
}
