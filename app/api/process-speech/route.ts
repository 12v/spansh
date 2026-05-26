import { NextRequest } from "next/server";
import OpenAI from "openai";
import { getPersonaById } from "@/lib/personas";
import type { TTSVoice } from "@/lib/personas/types";

export const runtime = "nodejs";

const openai = new OpenAI();

type HistoryMessage = { role: "user" | "assistant"; content: string };

function sseEvent(data: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

export async function POST(req: NextRequest) {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();

  (async () => {
    try {
      const formData = await req.formData();
      const audio = formData.get("audio") as File | null;
      const personaId = formData.get("personaId") as string | null;
      const historyJson = formData.get("history") as string | null;

      if (!audio || !personaId) {
        await writer.write(sseEvent({ type: "error", message: "Missing audio or personaId" }));
        return;
      }

      const persona = getPersonaById(personaId);
      if (!persona) {
        await writer.write(sseEvent({ type: "error", message: `Unknown persona: ${personaId}` }));
        return;
      }

      const history: HistoryMessage[] = historyJson ? JSON.parse(historyJson) : [];

      const rawTtsModel = formData.get("ttsModel") as string | null;
      const ttsModel: "gpt-4o-mini-tts" | "tts-1" | "tts-1-hd" =
        rawTtsModel === "tts-1" ? "tts-1"
        : rawTtsModel === "tts-1-hd" ? "tts-1-hd"
        : "gpt-4o-mini-tts";

      const rawGptModel = formData.get("gptModel") as string | null;
      const gptModel: "gpt-4o-mini" | "gpt-4o" =
        rawGptModel === "gpt-4o" ? "gpt-4o" : "gpt-4o-mini";

      const audioFormat: "opus" | "pcm" | "mp3" =
        formData.get("audioFormat") === "pcm" ? "pcm"
        : formData.get("audioFormat") === "mp3" ? "mp3"
        : "opus";

      const rawSttModel = formData.get("sttModel") as string | null;
      const sttModel: "gpt-4o-mini-transcribe" | "gpt-4o-transcribe" =
        rawSttModel === "gpt-4o-transcribe" ? "gpt-4o-transcribe" : "gpt-4o-mini-transcribe";

      // Step 1: Transcription (needs complete file)
      const transcription = await openai.audio.transcriptions.create({
        file: audio,
        model: sttModel,
        language: "es",
      });
      const transcript = transcription.text.trim();

      if (!transcript) {
        await writer.write(sseEvent({ type: "error", message: "No se detectó audio. Intenta de nuevo." }));
        return;
      }

      await writer.write(sseEvent({ type: "transcript", text: transcript }));

      // Step 2: GPT streaming — send text deltas immediately, accumulate full reply
      const completion = await openai.chat.completions.create({
        model: gptModel,
        messages: [
          { role: "system", content: persona.systemPrompt },
          ...history,
          { role: "user", content: transcript },
        ],
        stream: true,
      });

      let fullReply = "";
      for await (const chunk of completion) {
        const delta = chunk.choices[0]?.delta?.content ?? "";
        if (!delta) continue;
        await writer.write(sseEvent({ type: "text_delta", text: delta }));
        fullReply += delta;
      }

      // Step 3: Single Opus TTS call — stream bytes as they arrive from OpenAI
      const replyText = fullReply.trim();
      if (replyText) {
        const ttsRes = await openai.audio.speech.create({
          model: ttsModel,
          voice: persona.voice as TTSVoice,
          input: replyText,
          response_format: audioFormat,
          ...(ttsModel === "gpt-4o-mini-tts" && { instructions: persona.voiceInstructions }),
        });

        const reader = ttsRes.body!.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            await writer.write(sseEvent({
              type: "audio_chunk",
              data: Buffer.from(value).toString("base64"),
            }));
          }
        }
      }

      await writer.write(sseEvent({ type: "done", transcript, reply: fullReply }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[process-speech]", message);
      try {
        await writer.write(sseEvent({ type: "error", message }));
      } catch {
        // writer may be closed if client disconnected
      }
    } finally {
      writer.close().catch(() => {});
    }
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
