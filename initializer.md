# Tharros — Initializer Agent

You are the FIRST agent on this project. Your job is NOT to build features.
Your ONLY job is to set up the environment so every subsequent coding agent
can start immediately with zero ambiguity.

---

## Your tasks — do ALL of these in order

### 1. Read the spec

```bash
cat harness/app_spec.txt
```

Read it fully. This is your source of truth for everything.

### 2. Scaffold the Next.js project

```bash
npx create-next-app@latest . --typescript --tailwind --app --no-src-dir --import-alias "@/*" --no-git
```

Wait for completion. Verify `package.json` exists before continuing.

### 3. Install all dependencies

```bash
npm install @mux/mux-player-react @mux/mux-uploader-react zustand @fal-ai/client
npm install -D @types/node
```

### 4. Create .env.local

```
FAL_KEY=REPLACE_ME
NEXT_PUBLIC_OVERSHOOT_API_KEY=REPLACE_ME
NEXT_PUBLIC_ELEVENLABS_API_KEY=REPLACE_ME
NEXT_PUBLIC_ELEVENLABS_VOICE_ID=REPLACE_ME
MUX_TOKEN_ID=REPLACE_ME
MUX_TOKEN_SECRET=REPLACE_ME
NEXT_PUBLIC_MUX_ENV_KEY=REPLACE_ME
```

IMPORTANT: FAL_KEY has NO `NEXT_PUBLIC_` prefix. It is server-side only.

### 5. Create stub files

Create these files with a single `// TODO: implement` comment inside each.
The directory structure must exist exactly as shown — coding agents depend on it.

```
app/page.tsx
app/playback/page.tsx
app/api/mux-upload/route.ts
app/api/mux-asset/route.ts
app/api/fal-proxy/route.ts
lib/overshoot.ts
lib/fal-whisper.ts
lib/fal-analysis.ts
lib/elevenlabs.ts
lib/mux.ts
lib/coaching-store.ts
components/CoachOverlay.tsx
components/SessionControls.tsx
```

### 6. Create init.sh

```bash
#!/bin/bash
echo "=== Tharros Init ==="
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi
if [ ! -f ".env.local" ]; then
  echo "WARNING: .env.local not found. Copy .env.example and fill in keys."
fi
echo "Starting dev server at http://localhost:3000"
npm run dev
```

```bash
chmod +x init.sh
```

### 7. Create feature_list.json

Read the FEATURES section of `harness/app_spec.txt` carefully.
Create `feature_list.json` in the project root with all ~38 features listed there.

Every feature must follow this exact schema:

```json
[
  {
    "id": "webcam-001",
    "category": "webcam",
    "description": "Webcam stream displays in browser via getUserMedia",
    "steps": [
      "Open http://localhost:3000",
      "Allow camera permission when prompted",
      "Verify live webcam video is visible on the page"
    ],
    "passes": false
  }
]
```

Categories to use exactly: webcam, overshoot, fal-whisper, fal-analysis,
elevenlabs, mux-recording, playback-ui, session-flow, coach-overlay, resilience

RULES:
- Use valid JSON only. No comments. No trailing commas.
- Do NOT add features not in the spec. Do NOT skip any features from the spec.
- All features start with "passes": false.

### 8. Create claude-progress.txt

```
=== THARROS PROGRESS LOG ===
Project: Real-time AI interview coach
Hackathon: a16z x Overshoot x Fal x Mux, May 1 2026
Prizes targeted: #1 Realtime/streaming, #2 Multimodal

=== ARCHITECTURE SUMMARY ===
Live session — two parallel pipelines:
  VIDEO: Webcam canvas frame every 800ms → Overshoot VLM → visual signals
  AUDIO: Mic audio 5s chunks → /api/fal-proxy → fal/Wizper → filler words
Both pipelines → unified debounce engine → ElevenLabs WebSocket TTS (earpiece)
Recording: separate MediaRecorder → Mux Direct Upload (runs whole session)

Post-session:
  Mux playback URL → /api/fal-proxy → fal/openrouter (Gemini 2.5 Flash) → report card
  Report card displayed on /playback alongside Mux player + chapter markers

Key architectural rules for all coding agents:
  1. FAL_KEY is server-side only. ALL fal calls go through /api/fal-proxy.
  2. Two MediaRecorders run independently:
       - Primary (video+audio) → Mux upload
       - Secondary (audio-only) → 5s chunks → fal/Wizper
  3. Debounce engine is the single source of truth for ElevenLabs triggers.

--- SESSION 1: INITIALIZER (complete) ---
Status: Environment setup done
Actions taken:
  - Scaffolded Next.js 14 + TypeScript + Tailwind
  - Installed @fal-ai/client, @mux/mux-player-react, zustand
  - Created all stub files under app/, lib/, components/
  - Created feature_list.json with XX features (all passes: false)
  - Created init.sh
  - Created .env.local with placeholder values
Next agent should:
  - FIRST: fill in .env.local with real API keys (required before any feature works)
  - THEN: start with category "webcam" — get the camera showing before anything else
  - Build order: webcam → session-flow → overshoot → fal-whisper → elevenlabs → mux-recording → fal-analysis → playback-ui → coach-overlay → resilience
```

Replace XX with the actual feature count.

### 9. Initialize git

```bash
git init
git add .
git commit -m "init: scaffold Tharros with full harness structure

Stack: Next.js 14, TypeScript, Tailwind, @fal-ai/client, @mux/mux-player-react, zustand
Pipelines: Overshoot (visual) + fal/Wizper (audio) → ElevenLabs → Mux
Post-session: fal/Gemini 2.5 Flash coaching report
All features in feature_list.json marked failing — ready for coding agents"
```

### 10. Verify no TypeScript errors

```bash
npx tsc --noEmit
```

Fix any errors in stub files before committing. If stubs need a basic export to
satisfy TypeScript, add `export {}` at the bottom.

---

## What success looks like

A new coding agent should be able to:
1. `cat claude-progress.txt` — understand the full architecture in 60 seconds
2. `cat feature_list.json` — see every remaining feature with clear test steps
3. `bash init.sh` — start the dev server
4. Open http://localhost:3000 — see a placeholder page (no crash)
5. Pick the first failing webcam feature and start building

Do NOT implement any features. Environment setup only.
