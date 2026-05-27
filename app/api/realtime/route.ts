import { NextRequest } from "next/server";
import { getPersonaById } from "@/lib/personas";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const personaId = req.nextUrl.searchParams.get("personaId");

  if (!personaId) {
    return Response.json({ error: "Missing personaId" }, { status: 400 });
  }

  const persona = getPersonaById(personaId);
  if (!persona) {
    return Response.json({ error: `Unknown persona: ${personaId}` }, { status: 400 });
  }

  // POST /v1/realtime/sessions — GA Realtime API session creation.
  // Returns a session object with client_secret.value (eph_ token) which
  // the browser uses as the Bearer token in the /v1/realtime/calls SDP exchange.
  const res = await fetch("https://api.openai.com/v1/realtime/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-realtime-mini",
      voice: persona.voice,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return Response.json(
      { error: err?.error?.message ?? `OpenAI ${res.status}` },
      { status: res.status }
    );
  }

  const session = await res.json();
  return Response.json(session);
}
