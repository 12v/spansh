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

    // openai.realtime.clientSecrets.create() → POST /v1/realtime/client_secrets
    // This is the GA endpoint (no OpenAI-Beta header).
    // Returns { value: "ek_…", expires_at, session } — value is the ephemeral bearer token.
    const secret = await openai.realtime.clientSecrets.create({
      session: {
        type: "realtime",
        model: "gpt-realtime-mini",
        audio: {
          output: {
            voice: persona.voice,
          },
        },
      },
    });

    // Shape the response so the browser hook can read client_secret.value
    return Response.json({ client_secret: { value: secret.value } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/realtime]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
