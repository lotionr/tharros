import type { ChapterCue, CueLogEntry } from './coaching-store';

// ── Debounce state ────────────────────────────────────────────────────────────

interface SignalState {
  fireCount: number;
  windowStart: number;
  suppressedUntil: number;
}

const debounceState: Record<string, SignalState> = {};

let sessionStartTime = 0;
let chapterCues: ChapterCue[] = [];
let onChapterCue: ((cue: ChapterCue) => void) | null = null;
let onCueLog: ((entry: CueLogEntry) => void) | null = null;

// ── ElevenLabs WebSocket ──────────────────────────────────────────────────────

let ws: WebSocket | null = null;
let audioCtx: AudioContext | null = null;

export function openElevenLabsSocket(voiceId: string, apiKey: string): void {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  audioCtx = new AudioContext();

  const url = `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input?model_id=eleven_flash_v2_5`;
  ws = new WebSocket(url);

  ws.onopen = () => {
    // Send BOS (beginning-of-stream) message
    ws!.send(
      JSON.stringify({
        text: ' ',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        xi_api_key: apiKey,
      })
    );
  };

  ws.onmessage = async (event) => {
    try {
      const msg = JSON.parse(event.data as string);
      if (msg.audio) {
        const raw = atob(msg.audio);
        const buf = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
        const decoded = await audioCtx!.decodeAudioData(buf.buffer);
        const source = audioCtx!.createBufferSource();
        source.buffer = decoded;
        source.connect(audioCtx!.destination);
        source.start();
      }
    } catch {
      // ignore decode errors
    }
  };

  ws.onerror = () => {
    ws = null;
  };

  ws.onclose = () => {
    ws = null;
  };
}

export function closeElevenLabsSocket(): void {
  if (ws) {
    try { ws.close(); } catch { /* ignore */ }
    ws = null;
  }
  if (audioCtx) {
    try { audioCtx.close(); } catch { /* ignore */ }
    audioCtx = null;
  }
}

function speakViaElevenLabs(text: string): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify({ text, flush: true }));
  } catch {
    // WebSocket error — stay silent
  }
}

// ── Chapter cue recording ─────────────────────────────────────────────────────

function recordChapterCue(signalKey: string, cue: string): void {
  const elapsed = (Date.now() - sessionStartTime) / 1000;
  const entry: ChapterCue = {
    startTime: elapsed,
    endTime: elapsed + 1,
    value: `${signalKey} — ${cue}`,
  };
  chapterCues.push(entry);
  onChapterCue?.(entry);
  onCueLog?.({ time: Date.now(), signal: signalKey, cue });
}

// ── Public API ────────────────────────────────────────────────────────────────

export function initDebounceEngine(
  startTime: number,
  chapterCueCallback: (cue: ChapterCue) => void,
  cueLogCallback?: (entry: CueLogEntry) => void
): void {
  sessionStartTime = startTime;
  chapterCues = [];
  onChapterCue = chapterCueCallback;
  onCueLog = cueLogCallback ?? null;
  // Reset all per-signal state
  for (const key of Object.keys(debounceState)) {
    delete debounceState[key];
  }
}

export function onSignalFire(key: string, cue: string): void {
  const now = Date.now();
  if (!debounceState[key]) {
    debounceState[key] = { fireCount: 0, windowStart: now, suppressedUntil: 0 };
  }
  const s = debounceState[key];

  // Reset window if > 5s since last window start
  if (now - s.windowStart > 5000) {
    s.fireCount = 0;
    s.windowStart = now;
  }

  s.fireCount++;

  if (s.fireCount >= 3 && now > s.suppressedUntil) {
    speakViaElevenLabs(cue);
    s.suppressedUntil = now + 15000;
    s.fireCount = 0;
    recordChapterCue(key, cue);
  }
}

export function getChapterCues(): ChapterCue[] {
  return chapterCues;
}
