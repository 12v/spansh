import { NextRequest } from "next/server";
import OpenAI from "openai";
import { getPersonaById } from "@/lib/personas";
import type { TTSVoice } from "@/lib/personas/types";

export const runtime = "nodejs";

const openai = new OpenAI();

type HistoryMessage = { role: "user" | "assistant"; content: string };

// Sentence boundary: punctuation optionally followed by closing quotes/parens, then whitespace
const SENTENCE_END = /[.!?]['")\]]*\s/;

// Whisper hallucinates these phrases when given silence or near-silence
const WHISPER_HALLUCINATIONS = [
  "amara.org",
  "subtítulos realizados",
  "subtitles by",
  "gracias por ver",
  "thank you for watching",
  "transcribed by",
  "www.",
];

function isHallucination(text: string): boolean {
  const lower = text.toLowerCase();
  return WHISPER_HALLUCINATIONS.some((h) => lower.includes(h));
}

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

      // Step 1: Whisper (needs complete file)
      const transcription = await openai.audio.transcriptions.create({
        file: audio,
        model: "whisper-1",
        language: "es",
      });
      const transcript = transcription.text.trim();

      if (!transcript || isHallucination(transcript)) {
        await writer.write(sseEvent({ type: "error", message: "No se detectó audio. Intenta de nuevo." }));
        return;
      }

      await writer.write(sseEvent({ type: "transcript", text: transcript }));

      // Step 2: GPT streaming → sentence-chunked TTS
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: persona.systemPrompt },
          ...history,
          { role: "user", content: transcript },
        ],
        stream: true,
      });

      let sentenceBuffer = "";
      let fullReply = "";

      async function ttsAndStream(text: string) {
        const trimmed = text.trim();
        if (!trimmed) return;
        fullReply += (fullReply ? " " : "") + trimmed;

        const ttsRes = await openai.audio.speech.create({
          model: "tts-1",
          voice: persona!.voice as TTSVoice,
          input: trimmed,
          response_format: "mp3",
        });

        // Collect TTS stream chunks and send as one audio_chunk event
        const reader = ttsRes.body!.getReader();
        const parts: Uint8Array[] = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) parts.push(value);
        }
        const merged = Buffer.concat(parts);
        await writer.write(sseEvent({ type: "audio_chunk", data: merged.toString("base64") }));
      }

      // TTS runs in a separate promise chain so it never blocks GPT text streaming.
      // Each sentence is chained onto the previous to maintain playback order.
      let ttsChain = Promise.resolve();
      let ttsError: Error | null = null;

      function scheduleTts(sentence: string) {
        ttsChain = ttsChain.then(async () => {
          if (ttsError) return; // stop chain after first error
          try {
            await ttsAndStream(sentence);
          } catch (err) {
            ttsError = err instanceof Error ? err : new Error(String(err));
          }
        });
      }

      for await (const chunk of completion) {
        const delta = chunk.choices[0]?.delta?.content ?? "";
        if (!delta) continue;

        // Text flows to client without waiting for TTS
        await writer.write(sseEvent({ type: "text_delta", text: delta }));
        sentenceBuffer += delta;

        let match: RegExpExecArray | null;
        while ((match = SENTENCE_END.exec(sentenceBuffer)) !== null) {
          const cutAt = match.index + match[0].length - 1;
          const sentence = sentenceBuffer.slice(0, cutAt);
          sentenceBuffer = sentenceBuffer.slice(cutAt).trimStart();
          scheduleTts(sentence);
        }
      }

      // Schedule TTS for any remaining text, then wait for all TTS to finish
      scheduleTts(sentenceBuffer);
      await ttsChain;
      if (ttsError) throw ttsError;

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
