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

    // realtime.clientSecrets.create() → POST /realtime/client_secrets
    // Supports gpt-realtime-mini; returns { value: "ek_...", session: {...} }
    // The browser uses secret.value as the Bearer token for the SDP exchange.
    const secret = await openai.realtime.clientSecrets.create({
      session: {
        type: "realtime",
        model: "gpt-realtime-mini",
      },
    });

    return Response.json(secret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/realtime]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
