"use client";

import { Mic } from "lucide-react";
import { cn } from "@/lib/utils";

interface PushToTalkButtonProps {
  onPressStart: () => void;
  onPressEnd: () => void;
  disabled: boolean;
  isRecording: boolean;
  playbackVolume?: number;
}

export function PushToTalkButton({
  onPressStart,
  onPressEnd,
  disabled,
  isRecording,
  playbackVolume = 0,
}: PushToTalkButtonProps) {
  const isPlaying = playbackVolume > 0;

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
      disabled={disabled}
      onMouseDown={onPressStart}
      onMouseUp={onPressEnd}
      onMouseLeave={onPressEnd}
      onTouchStart={(e) => {
        e.preventDefault();
        onPressStart();
      }}
      onTouchEnd={(e) => {
        e.preventDefault();
        onPressEnd();
      }}
      onTouchCancel={(e) => {
        e.preventDefault();
        onPressEnd();
      }}
      style={style}
      className={cn(
        "relative flex items-center justify-center",
        "w-24 h-24 rounded-full",
        "focus:outline-none",
        !isPlaying && "transition-all duration-150",
        !isPlaying && "disabled:opacity-40 disabled:cursor-not-allowed",
        isRecording
          ? "bg-red-500 shadow-[0_0_0_8px_rgba(239,68,68,0.3)] animate-pulse"
          : isPlaying
          ? "bg-indigo-600"
          : "bg-indigo-600 hover:bg-indigo-500 shadow-[0_0_0_4px_rgba(99,102,241,0.3)] hover:shadow-[0_0_0_8px_rgba(99,102,241,0.25)]"
      )}
      aria-label={isRecording ? "Grabando — suelta para enviar" : "Mantén pulsado para hablar"}
    >
      <Mic className="w-10 h-10 text-white" strokeWidth={1.75} />
    </button>
  );
}
