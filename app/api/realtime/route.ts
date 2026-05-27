import { NextRequest } from "next/server";
import OpenAI from "openai";
import { getPersonaById } from "@/lib/personas";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const openai = new OpenAI();
    const personaId = req.nextUrl.searchParams.get("personaId");

    if (!personaId) {
      return Response.json({ error: "Missing personaId" }, { status: 400 });
    }

    const persona = getPersonaById(personaId);
    if (!persona) {
      return Response.json({ error: `Unknown persona: ${personaId}` }, { status: 400 });
    }

    // openai.beta.realtime.sessions.create() → POST /realtime/sessions
    // (same endpoint as client.realtime.sessions.create() in newer SDK versions)
    // Returns session.client_secret.value used as Bearer in the SDP exchange.
    const session = await openai.beta.realtime.sessions.create({
      model: "gpt-realtime-mini" as "gpt-4o-mini-realtime-preview",
      voice: persona.voice,
    });

    return Response.json(session);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/realtime]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
