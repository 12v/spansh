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
- **Voice AI**: OpenAI Realtime API via WebRTC
- **Backend**: Next.js Route Handlers only (no separate server)

The browser fetches an ephemeral token from `/api/realtime-session`, then connects directly to the OpenAI Realtime API via WebRTC. Audio is never proxied through the backend.

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
