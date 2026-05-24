export type TTSVoice = "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";

export interface Persona {
  id: string;
  displayName: string;
  description: string;
  systemPrompt: string;
  voice: TTSVoice;
  voiceInstructions: string;
  speakingStyle: string;
  accentRegion: string;
}
