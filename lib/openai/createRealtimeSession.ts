import "server-only";

export interface RealtimeSessionConfig {
  model: string;
  voice: string;
  instructions: string;
  inputAudioTranscription?: { model: string };
  turnDetection: null;
}

export interface EphemeralSessionResponse {
  id: string;
  client_secret: {
    value: string;
    expires_at: number;
  };
  model: string;
  voice: string;
}

export async function createRealtimeSession(
  config: RealtimeSessionConfig
): Promise<EphemeralSessionResponse> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(config),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI sessions API error ${response.status}: ${error}`);
  }

  return response.json() as Promise<EphemeralSessionResponse>;
}
