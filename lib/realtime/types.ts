export type ConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "error";

export interface RealtimeConnectionOptions {
  onTrack?: (event: RTCTrackEvent) => void;
  onError?: (error: Error) => void;
  onStateChange?: (state: ConnectionState) => void;
}
