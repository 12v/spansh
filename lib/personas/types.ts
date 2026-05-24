export type RealtimeVoice =
  | "alloy"
  | "ash"
  | "ballad"
  | "coral"
  | "echo"
  | "sage"
  | "shimmer"
  | "verse";

export interface Persona {
  id: string;
  displayName: string;
  description: string;
  systemPrompt: string;
  voice: RealtimeVoice;
  speakingStyle: string;
  accentRegion: string;
}
