import "server-only";

export interface EphemeralClientSecretResponse {
  value: string;
  expires_at: number;
}

export async function createRealtimeSession(config: {
  model: string;
  voice: string;
  instructions: string;
}): Promise<EphemeralClientSecretResponse> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      expires_after: { anchor: "created_at", seconds: 60 },
      session: {
        type: "realtime",
        model: config.model,
        instructions: config.instructions,
        audio: {
          output: { voice: config.voice },
          input: { turn_detection: null },
        },
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI sessions API error ${response.status}: ${error}`);
  }

  const data = await response.json();
  return {
    value: data.value,
    expires_at: data.expires_at,
  };
}
