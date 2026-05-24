# Spansh

Minimalist Spanish voice conversation app. Open the site, pick a persona, hold the mic button, speak — hear natural Spanish back.

## Getting Started

```bash
cp .env.example .env.local
# Add your OPENAI_API_KEY to .env.local

npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

| Variable | Description |
|---|---|
| `OPENAI_API_KEY` | OpenAI API key — server-side only, never exposed to the browser |

## Architecture

- **Frontend**: Next.js 15, TypeScript, Tailwind CSS v4
- **Backend**: Next.js Route Handlers only (no separate server)
- **Pipeline**: Whisper (transcription) → GPT-4o-mini (response) → TTS-1 (speech)

### How it works

1. Hold the mic button to record
2. Release to send — audio is uploaded to `/api/process-speech`
3. The server streams results back via Server-Sent Events (SSE):
   - Whisper transcribes the audio → transcript appears immediately
   - GPT-4o-mini streams the reply → text appears token by token
   - As each sentence completes, TTS-1 generates audio → plays without waiting for the full reply

Audio is never stored. The OpenAI API key stays server-side.

## Personas

| Name | Region | Voice Style |
|---|---|---|
| El Madrileño | Madrid | Coloquial |
| La Intelectual | Barcelona | Formal |
| Amigo Casual | México D.F. | Informal |
| La Periodista | Buenos Aires | Profesional |
| El Filósofo | Sevilla | Reflexivo |

## Deployment

Deploy to Vercel. Set `OPENAI_API_KEY` in Project Settings → Environment Variables.

## CI

GitHub Actions runs lint, typecheck, and build on every push and pull request.
