import type { SignalFireCallback } from './overshoot';

const FILLERS = ['um', 'uh', 'like', 'you know', 'so', 'basically', 'literally'];
const CHUNK_INTERVAL_MS = 5000;
const MIN_BLOB_SIZE = 1000; // bytes — skip near-silent / empty chunks

export type TranscriptUpdateCallback = (text: string, fillerWords: string[]) => void;
export type ErrorCallback = (msg: string) => void;

async function uploadAudioBlob(blob: Blob): Promise<string> {
  console.log('[Whisper] uploading audio chunk', blob.size, 'bytes');
  const file = new File([blob], 'chunk.webm', { type: blob.type || 'audio/webm' });
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/fal-proxy', { method: 'POST', body: form });
  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    throw new Error(`Upload failed (${res.status}): ${body}`);
  }
  const json = await res.json();
  if (!json.url) throw new Error(`Upload returned no URL: ${JSON.stringify(json)}`);
  console.log('[Whisper] upload OK →', json.url);
  return json.url;
}

async function transcribeChunk(audioUrl: string): Promise<string> {
  console.log('[Whisper] transcribing', audioUrl);
  const res = await fetch('/api/fal-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: 'fal-ai/wizper',
      input: {
        audio_url: audioUrl,
        task: 'transcribe',
        chunk_level: 'segment',
        version: '3',
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    throw new Error(`Transcription failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  if (data.error) throw new Error(`Wizper error: ${data.error}`);
  const text = (data.text as string) ?? '';
  console.log('[Whisper] transcript:', text || '(empty)');
  return text;
}

function detectFillers(text: string): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];
  if (lower.includes('you know')) found.push('you know');
  for (const w of lower.split(/\s+/)) {
    const clean = w.replace(/[^a-z]/g, '');
    if (['um', 'uh', 'like', 'so', 'basically', 'literally'].includes(clean)) {
      found.push(clean);
    }
  }
  return found;
}

function getBestMimeType(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
}

export function startWhisperPipeline(
  stream: MediaStream,
  onSignalFire: SignalFireCallback,
  onTranscriptUpdate: TranscriptUpdateCallback,
  onError?: ErrorCallback
): () => void {
  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length === 0) { console.warn('[Whisper] no audio tracks'); return () => {}; }

  const audioStream = new MediaStream(audioTracks);
  const mimeType = getBestMimeType();
  console.log('[Whisper] using mimeType:', mimeType || '(browser default)');

  let stopped = false;
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let currentRecorder: MediaRecorder | null = null;

  function recordChunk(): Promise<Blob> {
    return new Promise((resolve) => {
      const chunks: Blob[] = [];  // local per-chunk — no shared state

      let rec: MediaRecorder;
      try {
        rec = new MediaRecorder(audioStream, mimeType ? { mimeType } : undefined);
      } catch {
        rec = new MediaRecorder(audioStream);
      }
      currentRecorder = rec;

      rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
      rec.start();

      setTimeout(() => {
        if (rec.state !== 'inactive') rec.stop();
      }, CHUNK_INTERVAL_MS);
    });
  }

  async function processBlob(blob: Blob) {
    try {
      const audioUrl = await uploadAudioBlob(blob);
      if (stopped) return;
      const text = await transcribeChunk(audioUrl);
      const fillers = detectFillers(text);
      onTranscriptUpdate(text, fillers);
      if (fillers.length >= 1) {
        onSignalFire('filler_words', `You said "${fillers[0]}" — keep going`);
      }
    } catch (err: unknown) {
      if (stopped) return;
      const msg = err instanceof Error ? err.message : 'fal-proxy error';
      console.error('[Whisper]', msg);
      onError?.(msg);
    }
  }

  async function loop() {
    while (!stopped) {
      try {
        const blob = await recordChunk();
        if (stopped) break;
        if (blob.size < MIN_BLOB_SIZE) {
          console.log('[Whisper] chunk too small, skipping', blob.size, 'bytes');
          continue;
        }
        // Process concurrently — start recording next chunk immediately
        processBlob(blob);
      } catch (err: unknown) {
        if (stopped) break;
        const msg = err instanceof Error ? err.message : 'fal-proxy error';
        console.error('[Whisper] record error:', msg);
        onError?.(msg);
      }
    }
  }

  loop();

  return () => {
    stopped = true;
    if (intervalId) clearInterval(intervalId);
    try { currentRecorder?.stop(); } catch { /* ignore */ }
  };
}
