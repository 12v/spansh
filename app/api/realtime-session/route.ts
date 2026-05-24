import { NextRequest, NextResponse } from "next/server";
import { createRealtimeSession } from "@/lib/openai/createRealtimeSession";
import { getPersonaById } from "@/lib/personas";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { personaId } = await req.json();

    if (!personaId || typeof personaId !== "string") {
      return NextResponse.json({ error: "personaId is required" }, { status: 400 });
    }

    const persona = getPersonaById(personaId);
    if (!persona) {
      return NextResponse.json({ error: `Unknown persona: ${personaId}` }, { status: 400 });
    }

    const session = await createRealtimeSession({
      model: "gpt-4o-realtime-preview",
      voice: persona.voice,
      instructions: persona.systemPrompt,
    });

    return NextResponse.json({
      token: session.value,
      expiresAt: session.expires_at,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[realtime-session]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
