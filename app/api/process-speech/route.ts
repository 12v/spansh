import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { getPersonaById } from "@/lib/personas";
import type { TTSVoice } from "@/lib/personas/types";

export const runtime = "nodejs";

const openai = new OpenAI();

type HistoryMessage = { role: "user" | "assistant"; content: string };

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audio = formData.get("audio") as File | null;
    const personaId = formData.get("personaId") as string | null;
    const historyJson = formData.get("history") as string | null;

    if (!audio || !personaId) {
      return NextResponse.json({ error: "Missing audio or personaId" }, { status: 400 });
    }

    const persona = getPersonaById(personaId);
    if (!persona) {
      return NextResponse.json({ error: `Unknown persona: ${personaId}` }, { status: 400 });
    }

    const history: HistoryMessage[] = historyJson ? JSON.parse(historyJson) : [];

    const transcription = await openai.audio.transcriptions.create({
      file: audio,
      model: "whisper-1",
      language: "es",
    });
    const transcript = transcription.text.trim();

    if (!transcript) {
      return NextResponse.json({ error: "No se detectó audio. Intenta de nuevo." }, { status: 422 });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: persona.systemPrompt },
        ...history,
        { role: "user", content: transcript },
      ],
    });
    const reply = completion.choices[0].message.content ?? "";

    const ttsResponse = await openai.audio.speech.create({
      model: "tts-1",
      voice: persona.voice as TTSVoice,
      input: reply,
      response_format: "mp3",
    });

    const audioBuffer = await ttsResponse.arrayBuffer();
    const audioBase64 = Buffer.from(audioBuffer).toString("base64");

    return NextResponse.json({ transcript, reply, audio: audioBase64 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[process-speech]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
