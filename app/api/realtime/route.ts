import { NextRequest } from "next/server";
import OpenAI from "openai";
import { getPersonaById } from "@/lib/personas";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const openai = new OpenAI();
  const personaId = req.nextUrl.searchParams.get("personaId");

  if (!personaId) {
    return Response.json({ error: "Missing personaId" }, { status: 400 });
  }

  const persona = getPersonaById(personaId);
  if (!persona) {
    return Response.json({ error: `Unknown persona: ${personaId}` }, { status: 400 });
  }

  // Create a short-lived ephemeral token (eph_...) for WebRTC SDP auth.
  // beta.realtime.sessions is the path that supports the standard /v1/realtime
  // SDP endpoint used for direct browser-to-model WebRTC connections.
  const session = await openai.beta.realtime.sessions.create({
    model: "gpt-4o-mini-realtime-preview",
    voice: persona.voice,
  });

  // Return the full session object; client uses session.client_secret.value
  return Response.json(session);
}
