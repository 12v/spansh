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

  // openai.beta.realtime.sessions.create() POSTs to /realtime/sessions —
  // the GA Realtime API session endpoint. The "beta" prefix is the SDK's
  // package namespace, not an indication that the underlying API is
  // deprecated. The returned session.client_secret.value (eph_ token) is
  // used by the browser as the Bearer token in the /v1/realtime/calls SDP exchange.
  const session = await openai.beta.realtime.sessions.create({
    model: "gpt-realtime-mini" as "gpt-4o-mini-realtime-preview",
    voice: persona.voice,
  });

  return Response.json(session);
}
