"use client";

import { Mic } from "lucide-react";
import { cn } from "@/lib/utils";

interface PushToTalkButtonProps {
  onPressStart: () => void;
  onPressEnd: () => void;
  disabled: boolean;
  isRecording: boolean;
}

export function PushToTalkButton({
  onPressStart,
  onPressEnd,
  disabled,
  isRecording,
}: PushToTalkButtonProps) {
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
      style={{ touchAction: "none", userSelect: "none" }}
      className={cn(
        "relative flex items-center justify-center",
        "w-24 h-24 rounded-full",
        "transition-all duration-150",
        "focus:outline-none",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        isRecording
          ? "bg-red-500 shadow-[0_0_0_8px_rgba(239,68,68,0.3)] animate-pulse"
          : "bg-indigo-600 hover:bg-indigo-500 shadow-[0_0_0_4px_rgba(99,102,241,0.3)] hover:shadow-[0_0_0_8px_rgba(99,102,241,0.25)]"
      )}
      aria-label={isRecording ? "Grabando — suelta para enviar" : "Mantén pulsado para hablar"}
    >
      <Mic
        className={cn(
          "w-10 h-10 transition-colors duration-150",
          isRecording ? "text-white" : "text-white"
        )}
        strokeWidth={1.75}
      />
    </button>
  );
}
