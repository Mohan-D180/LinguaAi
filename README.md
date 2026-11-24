# LinguaAI

A full-stack multilingual language-practice app with React, Express, PostgreSQL, Prisma, and a private local Llama 3.2 3B model served by Ollama. Text-to-speech and browser speech recognition stay in the browser; all language-model requests go through the authenticated API.

## Requirements
- Node.js 20+
- npm
- Docker Desktop with the WSL 2 backend
- At least 8 GB of available memory is recommended for local model inference
- Allow roughly 12 GB of free disk space for the Ollama image and downloaded model

## Quick start on Windows

Open PowerShell in the project folder and run:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\setup.ps1
```

The setup script installs Node.js and Docker Desktop with `winget` if needed, creates missing local environment files, updates only the server's AI settings while preserving database and authentication values, builds the API container, starts PostgreSQL and Ollama, initializes the model once, waits for the API, and starts the web client. If WSL is installed for the first time, restart Windows and run the script again. Docker Desktop may also require first-run setup.

Open the Local URL printed by Vite (normally http://localhost:5173; if that port is busy, Vite selects another one).

## Manual Docker startup

Copy the templates once, then start the complete stack:

```powershell
Copy-Item .env.example .env
Copy-Item server/.env.example server/.env
Copy-Item client/.env.example client/.env
npm install
docker compose up -d --build
npm run dev -w client
```

Docker starts the API on port 4000, PostgreSQL on loopback port 5432, and Ollama on loopback port 11434. The API talks to Ollama over Docker's private network at `http://ollama:11434`; Ollama is not published to external interfaces. On first startup, the one-shot initializer downloads `llama3.2:3b` into a persistent named volume. Later starts reuse that volume.

The API container applies existing Prisma migrations at startup; it does not reset or delete database records. API health, including local model readiness: http://localhost:4000/api/v1/health

## Local backend development

To run the Express and Vite development servers directly on the host while keeping PostgreSQL and Ollama in Docker:

```powershell
docker compose up -d db ollama ollama-init
npm install
npm run db:generate
npm run db:migrate
npm run dev
```

The host backend uses `OLLAMA_BASE_URL=http://localhost:11434`. The Compose API container overrides this with the private Docker hostname.

## Local AI configuration

```env
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://ollama:11434
OLLAMA_MODEL=llama3.2:3b
```

The Compose API uses the internal Ollama URL above. The host-run development server uses `http://localhost:11434`. No cloud LLM key or external AI service is required. The `/api/v1/health` response reports `ready`, `model_missing`, or `unavailable` for Ollama.

## Voice
Voice input uses the browser Web Speech API where supported (Chrome/Edge support varies by platform). The browser may require microphone permission and HTTPS or localhost. Speech output uses `speechSynthesis`. If speech recognition is unavailable, type into the chat box.

## Useful commands

```bash
npm run dev
npm run build
npm run test
npm run db:studio
```

## Security notes
- Passwords are hashed with bcrypt.
- Access tokens are short-lived JWTs.
- Refresh tokens are stored as hashes in the database and rotated.
- Refresh token is held in an HttpOnly cookie.
- Protected API routes enforce ownership.
- Helmet, CORS allowlisting, Zod validation, and rate limiting are enabled.
- Ollama and PostgreSQL host ports bind to loopback only; the API accesses Ollama through Docker's internal network.
- Keep `server/.env` and the root `.env` private. Use strong authentication secrets before production deployment.
- This is a development starter, not a security-audited production deployment. Configure HTTPS, email verification, password reset delivery, backups, monitoring, and stricter production rate limits before launch.

## Project structure

```text
client/   React + Vite + TypeScript UI
server/   Express API + Prisma + AI provider adapter
server/src/services/  Local Ollama tutor integration
```
