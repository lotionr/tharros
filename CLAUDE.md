# Tharros — Real-Time AI Interview Coach

## What this project is

Tharros is a real-time AI interview coach that watches the user via webcam and delivers
live voice coaching through an earpiece. Built solo at the a16z x Overshoot x Fal x Mux
Video Hackathon (May 1 2026, 4-hour build window).

Targeting Prize #1 (Realtime/streaming) and Prize #2 (Multimodal).

---

## Tech stack

- **Framework:** Next.js 14 (App Router), TypeScript, Tailwind CSS
- **Visual analysis:** Overshoot API — frame-grab every 800ms → VLM → eye contact, posture, expression, pacing
- **Audio transcription:** fal/Wizper (Whisper v3) — mic audio in 5s chunks → real filler word detection
- **Voice output:** ElevenLabs Flash v2.5 — WebSocket streaming TTS, <1s latency
- **Post-session analysis:** fal/openrouter (Gemini 2.5 Flash) — full recording → written coaching report
- **Session recording:** Mux Direct Upload + `@mux/mux-player-react` + chapter markers

---

## Environment variables

```
NEXT_PUBLIC_OVERSHOOT_API_KEY=
NEXT_PUBLIC_ELEVENLABS_API_KEY=
NEXT_PUBLIC_ELEVENLABS_VOICE_ID=
FAL_KEY=
MUX_TOKEN_ID=
MUX_TOKEN_SECRET=
NEXT_PUBLIC_MUX_ENV_KEY=
```

Note: FAL_KEY is server-side only (no NEXT_PUBLIC_ prefix). All fal calls go through
the /api/fal-proxy route to keep the key off the browser.

---

## Running the app

```bash
npm install
npm run dev   # http://localhost:3000
```

---

## Full data flow

### Live session (two parallel pipelines)

```
Webcam video
  └─ canvas frame every 800ms ──► Overshoot VLM
                                      └─ { eye_contact, posture, expression, pacing }
                                                              │
Microphone audio                                              ▼
  └─ 5s audio chunks ──► /api/fal-proxy ──► fal/Wizper   Debounce engine
                              (server)          └─ transcript  │  (3 fires in 5s
                                                    └─ fillers─►│   → speak once
                                                                │   → suppress 15s)
                                                                ▼
                                                    ElevenLabs WebSocket TTS
                                                        └─ voice cue in earpiece

Webcam stream (parallel, always running)
  └─ MediaRecorder ──► Mux Direct Upload ──► session recording
```

### Post-session (async, runs while Mux processes)

```
Mux playback URL ──► /api/fal-proxy ──► fal/openrouter (gemini-2.5-flash)
                                              └─ JSON coaching report card
                                                     displayed on /playback
```

---

## Key source files

```
src/
  app/
    page.tsx                  ← main coach UI (webcam + live overlay)
    playback/page.tsx         ← post-session review page
    api/
      mux-upload/route.ts     ← creates Mux Direct Upload URL (server-side)
      mux-asset/route.ts      ← polls Mux asset status + playback ID
      fal-proxy/route.ts      ← server-side proxy for ALL fal API calls
  lib/
    overshoot.ts              ← canvas frame loop + VLM prompt + response parser
    fal-whisper.ts            ← mic audio chunking + Wizper STT + filler detection
    fal-analysis.ts           ← post-session report via Gemini 2.5 Flash
    elevenlabs.ts             ← WebSocket TTS + unified debounce logic
    mux.ts                    ← upload session + chapter cue accumulator
    coaching-store.ts         ← Zustand shared state
  components/
    CoachOverlay.tsx          ← live signal badges (scores + firing indicators)
    SessionControls.tsx       ← start/stop session button + timer
```

---

## Overshoot — visual signals only (lib/overshoot.ts)

Pull a canvas frame from the video element every 800ms during active session.
POST base64 JPEG to Overshoot with this prompt.

**System prompt:**
`You are an expert interview coach analyzing a video frame. Return ONLY valid JSON, no other text.`

**User prompt + required response schema:**
```json
{
  "eye_contact": { "score": <0-10>, "cue": "<≤8 word coaching cue or empty>", "fire": <true if score < 5> },
  "posture":     { "score": <0-10>, "cue": "<≤8 word coaching cue or empty>", "fire": <true if score < 5> },
  "expression":  { "score": <0-10>, "cue": "<≤8 word coaching cue or empty>", "fire": <true if score < 6> },
  "pacing":      { "score": <0-10>, "cue": "<≤8 word coaching cue or empty>", "fire": <true if score < 4 or > 9> }
}
```

NOTE: `pacing` here is VISUAL pacing — rushed body language, breathless expression.
Audio pacing and filler words come from fal/Whisper, not Overshoot.

Cue examples: "Look at the camera", "Sit up straight", "Show more energy", "Slow down"

---

## fal/Wizper — audio transcription + filler detection (lib/fal-whisper.ts)

Records mic audio using a SEPARATE MediaRecorder (audio-only, audio/webm codec).
Every 5 seconds: stop the recorder → get blob → upload to fal storage → call Wizper → scan for fillers.
Immediately restart recorder for the next 5s chunk.

**Fal API call:**
```typescript
import { fal } from "@fal-ai/client";

// Step 1: upload the audio blob
const audioFile = new File([blob], "chunk.webm", { type: "audio/webm" });
const audioUrl = await fal.storage.upload(audioFile);

// Step 2: transcribe
const result = await fal.subscribe("fal-ai/wizper", {
  input: {
    audio_url: audioUrl,
    task: "transcribe",
    chunk_level: "word",
    version: "3"
  }
});

// Step 3: scan transcript for fillers
const transcript = result.data.text;
const FILLERS = ["um", "uh", "like", "you know", "so", "basically", "literally"];
const words = transcript.toLowerCase().split(/\s+/);
const found = words.filter(w => FILLERS.includes(w));
```

**Filler signal (fed into the same debounce engine as Overshoot signals):**
```typescript
if (found.length >= 2) {
  onSignalFire("filler_words", `You said "${found[0]}" — keep going`);
}
```

**Important:** fal.config must be called with credentials. Do this in the fal-proxy API
route, not client-side. The client calls `/api/fal-proxy` which forwards to fal.

---

## fal/openrouter — post-session report card (lib/fal-analysis.ts)

Called once after session ends. Waits for Mux asset to be ready, then sends the
HLS playback URL to Gemini 2.5 Flash via fal's OpenRouter endpoint.

**Fal API call:**
```typescript
const result = await fal.subscribe("openrouter/router/video", {
  input: {
    video_urls: [`https://stream.mux.com/${playbackId}.m3u8`],
    model: "google/gemini-2.5-flash",
    system_prompt: "You are a professional interview coach. Be specific and constructive. Return only valid JSON.",
    prompt: `Analyze this interview practice session. Return exactly this JSON:
{
  "overall_score": <1-10>,
  "confidence_rating": "<Poor|Fair|Good|Strong>",
  "top_strengths": ["<strength 1>", "<strength 2>"],
  "top_improvements": ["<improvement 1>", "<improvement 2>"],
  "summary": "<2-3 sentence coaching summary>"
}`
  }
});

const report = JSON.parse(result.data.output);
```

---

## /api/fal-proxy/route.ts

Server-side route that proxies all fal calls. Keeps FAL_KEY off the browser.

```typescript
// POST /api/fal-proxy
// Body: { endpoint: string, input: object }
import { fal } from "@fal-ai/client";

fal.config({ credentials: process.env.FAL_KEY });

export async function POST(req: Request) {
  const { endpoint, input } = await req.json();
  const result = await fal.subscribe(endpoint, { input });
  return Response.json(result.data);
}
```

Client-side code calls `/api/fal-proxy` instead of fal directly.

---

## ElevenLabs debounce engine (lib/elevenlabs.ts)

Single debounce engine handles ALL signal sources — Overshoot visual signals AND
fal/Whisper filler words. Both call `onSignalFire(key, cue)`.

```typescript
type SignalState = { fireCount: number; windowStart: number; suppressedUntil: number }
const state: Record<string, SignalState> = {}

export function onSignalFire(key: string, cue: string) {
  const now = Date.now()
  const s = state[key] ??= { fireCount: 0, windowStart: now, suppressedUntil: 0 }
  if (now - s.windowStart > 5000) { s.fireCount = 0; s.windowStart = now }
  s.fireCount++
  if (s.fireCount >= 3 && now > s.suppressedUntil) {
    speakViaElevenLabs(cue)
    s.suppressedUntil = now + 15000
    s.fireCount = 0
    recordChapterCue(key, cue)
  }
}
```

ElevenLabs WebSocket: connect on session start, keep open, send text chunks,
receive PCM audio, pipe to AudioContext for playback.

---

## Mux chapters (lib/mux.ts)

When ElevenLabs fires, `recordChapterCue` appends to the chapter log:
```typescript
chapterCues.push({
  startTime: (Date.now() - sessionStartTime) / 1000,
  endTime: (Date.now() - sessionStartTime) / 1000 + 1,
  value: `${signalKey} — ${cue}`
})
```

On `/playback`, render these as a custom annotation timeline above the Mux player.

---

## Zustand store shape (lib/coaching-store.ts)

```typescript
{
  isSessionActive: boolean,
  sessionStartTime: number | null,
  currentSignals: VisualSignals | null,       // latest Overshoot output
  latestTranscript: string,                    // latest Whisper chunk
  fillerCount: number,                         // session cumulative filler count
  cueLog: Array<{ time: number; signal: string; cue: string }>,
  chapterCues: Array<{ startTime: number; endTime: number; value: string }>,
  reportCard: ReportCard | null,               // fal/Gemini output, set post-session
  muxAssetId: string | null,
  muxPlaybackId: string | null,
}
```

---

## Demo script (3 minutes)

1. "I'm going to give a 30-second pitch while Tharros coaches me live"
   → start session, speak, show ElevenLabs cues firing in real time via earpiece
2. "Here's what Tharros was seeing" → show overlay scores updating live
3. "Stop session → here's the game film" → Mux playback with chapter markers on timeline
4. "And here's the AI report card" → show fal/Gemini coaching report
5. "Four APIs, four jobs: Overshoot watches my body, fal hears my words,
   ElevenLabs coaches me live, Mux and fal review my performance after"

---

## Coding agent rules

1. Read `claude-progress.txt` and `git log --oneline -20` before doing anything
2. Run `bash init.sh`, smoke test at http://localhost:3000 before feature work
3. ONE failing feature per session — no more
4. Mark `"passes": true` only after manual browser verification
5. Commit + update `claude-progress.txt` at end of every session
6. Never leave the app broken — revert with `git checkout -- <file>` if needed
7. ALL fal calls go through `/api/fal-proxy` — never put FAL_KEY in client code
8. The two MediaRecorders (video→Mux, audio→Whisper) run independently — don't confuse them
