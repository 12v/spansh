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

  // Mint a short-lived client secret (ek_...) for WebRTC SDP auth.
  // Voice and instructions are applied via session.update once the data channel opens.
  const secret = await openai.realtime.clientSecrets.create({
    session: {
      type: "realtime",
      model: "gpt-realtime-mini",
    },
  });

  // Client uses secret.value as the Bearer token in the SDP offer
  return Response.json(secret);
}
