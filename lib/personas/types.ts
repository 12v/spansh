// Realtime API voices (gpt-realtime-mini)
export type RealtimeVoice =
  | "alloy" | "ash" | "ballad" | "coral" | "echo"
  | "sage" | "shimmer" | "verse" | "marin" | "cedar";

export interface Persona {
  id: string;
  displayName: string;
  description: string;
  systemPrompt: string;
  voice: RealtimeVoice;
  voiceInstructions: string;
  speakingStyle: string;
  accentRegion: string;
}
