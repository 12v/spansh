import { NextRequest } from "next/server";
import { getPersonaById } from "@/lib/personas";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const personaId = req.nextUrl.searchParams.get("personaId");

    if (!personaId) {
      return Response.json({ error: "Missing personaId" }, { status: 400 });
    }

    const persona = getPersonaById(personaId);
    if (!persona) {
      return Response.json({ error: `Unknown persona: ${personaId}` }, { status: 400 });
    }

    // Direct fetch — no SDK, no OpenAI-Beta header injected by the beta namespace.
    // POST /v1/realtime/sessions is the GA session creation endpoint.
    // Returns session.client_secret.value used as the Bearer token in the SDP exchange.
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
      const msg = err?.error?.message ?? `OpenAI ${res.status}`;
      console.error("[api/realtime]", msg);
      return Response.json({ error: msg }, { status: res.status });
    }

    const session = await res.json();
    return Response.json(session);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/realtime]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
