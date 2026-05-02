import type { SignalFireCallback } from './overshoot';

const FILLERS = ['um', 'uh', 'like', 'you know', 'so', 'basically', 'literally'];
const CHUNK_INTERVAL_MS = 5000;

export type TranscriptUpdateCallback = (text: string, fillerWords: string[]) => void;
export type ErrorCallback = (msg: string) => void;

async function uploadAudioBlob(blob: Blob): Promise<string> {
  const file = new File([blob], 'chunk.webm', { type: 'audio/webm' });
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/fal-proxy', { method: 'POST', body: form });
  if (!res.ok) throw new Error('Upload failed');
  const { url } = await res.json();
  return url;
}

async function transcribeChunk(audioUrl: string): Promise<string> {
  const res = await fetch('/api/fal-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: 'fal-ai/wizper',
      input: {
        audio_url: audioUrl,
        task: 'transcribe',
        chunk_level: 'word',
        version: '3',
      },
    }),
  });
  if (!res.ok) throw new Error('Transcription failed');
  const data = await res.json();
  return (data.text as string) ?? '';
}

function detectFillers(text: string): string[] {
  const lower = text.toLowerCase();
  const words = lower.split(/\s+/);
  const found: string[] = [];

  // Check multi-word fillers first
  if (lower.includes('you know')) found.push('you know');

  for (const w of words) {
    const clean = w.replace(/[^a-z]/g, '');
    if (['um', 'uh', 'like', 'so', 'basically', 'literally'].includes(clean)) {
      found.push(clean);
    }
  }
  return found;
}

export function startWhisperPipeline(
  stream: MediaStream,
  onSignalFire: SignalFireCallback,
  onTranscriptUpdate: TranscriptUpdateCallback,
  onError?: ErrorCallback
): () => void {
  // Audio-only stream (clone video stream's audio tracks)
  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length === 0) return () => {};

  const audioStream = new MediaStream(audioTracks);

  let stopped = false;
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let intervalId: ReturnType<typeof setInterval> | null = null;

  function startChunk() {
    if (stopped) return;
    chunks = [];
    try {
      recorder = new MediaRecorder(audioStream, { mimeType: 'audio/webm' });
    } catch {
      recorder = new MediaRecorder(audioStream);
    }

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = async () => {
      if (stopped || chunks.length === 0) return;
      const blob = new Blob(chunks, { type: 'audio/webm' });
      chunks = [];
      try {
        const audioUrl = await uploadAudioBlob(blob);
        const text = await transcribeChunk(audioUrl);
        const fillers = detectFillers(text);

        onTranscriptUpdate(text, fillers);

        if (fillers.length >= 2) {
          onSignalFire('filler_words', `You said "${fillers[0]}" — keep going`);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'fal-proxy error';
        onError?.(msg);
      }
    };

    recorder.start();
  }

  startChunk();

  intervalId = setInterval(() => {
    if (stopped) return;
    recorder?.stop();
    startChunk();
  }, CHUNK_INTERVAL_MS);

  return () => {
    stopped = true;
    if (intervalId) clearInterval(intervalId);
    try { recorder?.stop(); } catch { /* ignore */ }
  };
}
