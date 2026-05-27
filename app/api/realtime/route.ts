import { NextRequest } from "next/server";
import OpenAI from "openai";
import { getPersonaById } from "@/lib/personas";
import type { RealtimeVoice } from "@/lib/personas/types";

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

  // Create a short-lived client secret for WebRTC SDP auth.
  // The returned `value` is sent as the Bearer token in the client's SDP offer.
  const secret = await openai.realtime.clientSecrets.create({
    session: {
      type: "realtime",
      model: "gpt-realtime-mini",
      // Voice and instructions are overridden via session.update once the
      // data channel opens, but setting voice here locks it in early.
      audio: {
        output: { voice: persona.voice as RealtimeVoice & string },
      },
    },
  });

  return Response.json(secret);
}
