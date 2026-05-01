# Tharros — Coding Agent

You are a coding agent working on Tharros. The environment is already set up.
Read CLAUDE.md and harness/app_spec.txt — they contain the full architecture.

---

## Step 1: Get your bearings (do this EVERY session, no exceptions)

```bash
pwd
cat claude-progress.txt
git log --oneline -20
```

```bash
node -e "
const f = require('./feature_list.json');
const failing = f.filter(x => !x.passes);
const byCat = failing.reduce((a, x) => { (a[x.category] = a[x.category]||[]).push(x); return a; }, {});
console.log(failing.length + ' features still failing:');
Object.entries(byCat).forEach(([cat, items]) => {
  console.log('  [' + cat + '] ' + items.length + ' remaining');
  items.slice(0, 2).forEach(x => console.log('    - [' + x.id + '] ' + x.description));
});
"
```

## Step 2: Smoke test

```bash
bash init.sh &
sleep 6
```

Open http://localhost:3000 in a browser. Verify it loads without a compile error.

**If the app is broken:** STOP. Do not start new feature work.
Read `git log --oneline -5` and `git diff HEAD~1` to understand what broke.
Fix it or revert: `git checkout -- <broken-file>`. Commit the fix first.

## Step 3: Pick ONE feature

Choose the highest-priority failing feature based on this build order:

1. webcam
2. session-flow
3. overshoot
4. fal-whisper
5. elevenlabs
6. mux-recording
7. fal-analysis
8. playback-ui
9. coach-overlay
10. resilience

State clearly before writing any code:
**"I am implementing: [feature-id] — [description]"**

## Step 4: Implement

Read these before writing code:
- `CLAUDE.md` — architecture, data flow, API schemas, debounce rules
- `harness/app_spec.txt` — full spec including exact API call patterns
- The stub file you're about to implement

---

### Implementation patterns by category

**webcam:**
Use `navigator.mediaDevices.getUserMedia({ video: true, audio: true })`.
Assign stream to a `<video>` element's `srcObject`. Call `video.play()`.
Store stream ref in useRef so it's accessible to both MediaRecorders.

**overshoot (lib/overshoot.ts):**
```typescript
// Frame grab loop — runs every 800ms during session
const canvas = document.createElement('canvas');
canvas.width = 640; canvas.height = 480;
const ctx = canvas.getContext('2d')!;

const loop = setInterval(async () => {
  ctx.drawImage(videoRef.current!, 0, 0, 640, 480);
  const base64 = canvas.toDataURL('image/jpeg', 0.7).split(',')[1];
  const res = await fetch('https://api.overshoot.ai/v1/analyze', {  // check actual endpoint
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.NEXT_PUBLIC_OVERSHOOT_API_KEY}` },
    body: JSON.stringify({ image: base64, prompt: OVERSHOOT_SYSTEM_PROMPT })
  });
  const signals = await res.json();
  // For each signal with fire: true → onSignalFire(key, cue)
}, 800);
```

**fal-whisper (lib/fal-whisper.ts):**
```typescript
// Audio-only MediaRecorder — separate from the Mux video recorder
const audioRecorder = new MediaRecorder(audioOnlyStream, { mimeType: 'audio/webm' });
let chunks: Blob[] = [];

audioRecorder.ondataavailable = e => chunks.push(e.data);
audioRecorder.onstop = async () => {
  const blob = new Blob(chunks, { type: 'audio/webm' });
  chunks = [];
  // Upload through proxy
  const form = new FormData();
  form.append('endpoint', 'fal-ai/wizper');
  form.append('input', JSON.stringify({
    audio_url: await uploadToFalStorage(blob),  // or upload client-side if fal allows
    task: 'transcribe',
    chunk_level: 'word',
    version: '3'
  }));
  const res = await fetch('/api/fal-proxy', { method: 'POST', body: form });
  const data = await res.json();
  const text = data.text || '';
  const FILLERS = ['um','uh','like','you know','so','basically','literally'];
  const found = text.toLowerCase().split(/\s+/).filter((w: string) => FILLERS.includes(w));
  if (found.length >= 2) onSignalFire('filler_words', `You said "${found[0]}" — keep going`);
  updateTranscript(text);  // update zustand store for live display
};

// Restart every 5 seconds
audioRecorder.start();
setInterval(() => { audioRecorder.stop(); audioRecorder.start(); }, 5000);
```

NOTE on fal storage upload: Use the fal client's `fal.storage.upload()` method.
But since FAL_KEY is server-side only, the audio upload also goes through /api/fal-proxy.
Extend the proxy route to handle file uploads if needed, or use a separate
`/api/fal-upload` route that accepts FormData with a file blob.

**fal-proxy (/api/fal-proxy/route.ts):**
```typescript
import { fal } from '@fal-ai/client';
import { NextRequest } from 'next/server';

fal.config({ credentials: process.env.FAL_KEY });

export async function POST(req: NextRequest) {
  try {
    const { endpoint, input } = await req.json();
    const result = await fal.subscribe(endpoint, { input });
    return Response.json(result.data);
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
```

**fal-analysis (lib/fal-analysis.ts):**
```typescript
// Called ONCE after session ends, while Mux is processing
export async function analyzeSession(playbackId: string) {
  const res = await fetch('/api/fal-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: 'openrouter/router/video',
      input: {
        video_urls: [`https://stream.mux.com/${playbackId}.m3u8`],
        model: 'google/gemini-2.5-flash',
        system_prompt: 'You are a professional interview coach. Return only valid JSON, no other text.',
        prompt: `Analyze this interview practice session. Return exactly this JSON:
{"overall_score":<1-10>,"confidence_rating":"<Poor|Fair|Good|Strong>",
"top_strengths":["<s1>","<s2>"],"top_improvements":["<i1>","<i2>"],
"summary":"<2-3 sentence coaching summary>"}`
      }
    })
  });
  const raw = await res.json();
  return JSON.parse(raw.output);  // raw.output is the model's text response
}
```

**elevenlabs (lib/elevenlabs.ts):**
Connect WebSocket on session start:
```
wss://api.elevenlabs.io/v1/text-to-speech/{voiceId}/stream-input?model_id=eleven_flash_v2_5
```
Send `{ text: cueText, xi_api_key: process.env.NEXT_PUBLIC_ELEVENLABS_API_KEY }`.
Receive binary audio chunks → decode → pipe to AudioContext for playback.

**mux-recording (lib/mux.ts):**
1. `POST /api/mux-upload` → `{ uploadUrl, uploadId }`
2. `new MediaRecorder(fullStream, { mimeType: 'video/webm' })` (video+audio together)
3. `ondataavailable` → `fetch(uploadUrl, { method: 'PUT', body: chunk })`
4. On stop → final PUT → poll `/api/mux-asset?uploadId=xxx` every 3s until `status === 'ready'`
5. On ready → navigate to `/playback?playbackId=xxx`

---

## Step 5: Test end-to-end

Go through the exact steps in `feature_list.json` for your feature.
Test in the browser as a real user. Do not mark passing based on code review alone.

Only if ALL steps pass:
```json
"passes": true
```

## Step 6: Commit and update progress

```bash
git add -A
git commit -m "feat(category): description

Feature: feature-id
Tested: manual browser verification — [brief note]"
```

Then APPEND to `claude-progress.txt` (never overwrite):

```
--- SESSION N: [title] ---
Feature completed: [feature-id] — [description]
Tested: [how]
Issues: [any gotchas, or none]
Next: [which category to tackle next]
```

---

## Hard rules

- ONE feature per session. No exceptions.
- Never edit `feature_list.json` except to change `"passes"` from false to true.
- Never delete features from `feature_list.json`.
- Never leave the app in a broken state at end of session.
- Always commit — even partial work (use `wip:` prefix and document in progress file).
- ALL fal calls go through `/api/fal-proxy`. Never put FAL_KEY in client code.
- The two MediaRecorders are independent — primary (video+audio → Mux) and secondary (audio-only → Whisper). Do not conflate them.
- `fal.storage.upload()` requires the fal client, which requires FAL_KEY, which is server-only. Handle file uploads through a server route.
