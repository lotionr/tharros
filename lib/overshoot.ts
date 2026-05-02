import { StreamClient } from '@overshoot/sdk';
import type { VisualSignals } from './coaching-store';

export type SignalFireCallback = (key: string, cue: string) => void;
export type SignalsUpdateCallback = (signals: VisualSignals) => void;
export type OvershootErrorCallback = (msg: string) => void;

const API_URL = 'https://cluster1.overshoot.ai/api/v0.2';

const PROMPT = `You are an expert interview coach. Analyze the candidate's body language.
Return ONLY valid JSON exactly matching this schema — no other text.`;

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    eye_contact: {
      type: 'object',
      properties: {
        score: { type: 'number', description: '0-10' },
        cue:   { type: 'string', description: 'coaching cue ≤8 words, or empty string' },
        fire:  { type: 'boolean', description: 'true if score < 5' },
      },
      required: ['score', 'cue', 'fire'],
    },
    posture: {
      type: 'object',
      properties: {
        score: { type: 'number' },
        cue:   { type: 'string' },
        fire:  { type: 'boolean', description: 'true if score < 5' },
      },
      required: ['score', 'cue', 'fire'],
    },
    expression: {
      type: 'object',
      properties: {
        score: { type: 'number' },
        cue:   { type: 'string' },
        fire:  { type: 'boolean', description: 'true if score < 6' },
      },
      required: ['score', 'cue', 'fire'],
    },
    pacing: {
      type: 'object',
      properties: {
        score: { type: 'number' },
        cue:   { type: 'string' },
        fire:  { type: 'boolean', description: 'true if score < 4 or score > 9' },
      },
      required: ['score', 'cue', 'fire'],
    },
  },
  required: ['eye_contact', 'posture', 'expression', 'pacing'],
};

const SIGNAL_KEYS = ['eye_contact', 'posture', 'expression', 'pacing'] as const;

export function startOvershootLoop(
  stream: MediaStream,
  onSignalFire: SignalFireCallback,
  onSignalsUpdate: SignalsUpdateCallback,
  onError?: OvershootErrorCallback
): () => void {
  const apiKey = process.env.NEXT_PUBLIC_OVERSHOOT_API_KEY ?? '';
  if (!apiKey) { onError?.('NEXT_PUBLIC_OVERSHOOT_API_KEY not set'); return () => {}; }

  const client = new StreamClient({ baseUrl: API_URL, apiKey });
  let pc: RTCPeerConnection | null = null;
  let ws: WebSocket | null = null;
  let keepaliveId: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  async function init() {
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) throw new Error('No video track in stream');

    pc = new RTCPeerConnection();
    pc.addTrack(videoTrack, stream);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // Wait for ICE gathering to complete
    await new Promise<void>((resolve) => {
      if (pc!.iceGatheringState === 'complete') { resolve(); return; }
      pc!.onicecandidate = (e) => { if (e.candidate === null) resolve(); };
      setTimeout(resolve, 3000); // fallback
    });

    if (stopped) return;

    const response = await client.createStream({
      webrtc: { type: 'offer', sdp: pc.localDescription!.sdp },
      processing: {
        sampling_ratio: 0.5,
        fps: 30,
        clip_length_seconds: 1.0,
        delay_seconds: 1.0,
      },
      inference: {
        prompt: PROMPT,
        backend: 'overshoot',
        model: 'Qwen/Qwen3-VL-30B-A3B-Instruct',
        output_schema_json: OUTPUT_SCHEMA,
      },
    });

    await pc.setRemoteDescription(response.webrtc);

    if (stopped) return;

    // Keepalive every 60s (lease is 300s)
    keepaliveId = setInterval(() => {
      client.renewLease(response.stream_id).catch(() => {});
    }, 60_000);

    // WebSocket for inference results
    ws = client.connectWebSocket(response.stream_id);
    ws.onopen = () => {
      ws!.send(JSON.stringify({ api_key: apiKey }));
    };
    ws.onmessage = (event) => {
      if (stopped) return;
      try {
        const msg = JSON.parse(event.data as string);
        if (!msg.ok || !msg.result) return;
        const signals: VisualSignals = JSON.parse(msg.result);
        onSignalsUpdate(signals);
        for (const key of SIGNAL_KEYS) {
          const sig = signals[key];
          if (sig?.fire && sig?.cue) onSignalFire(key, sig.cue);
        }
      } catch {
        // ignore malformed frames
      }
    };
    ws.onerror = () => onError?.('Overshoot WebSocket error');
    ws.onclose = (e) => {
      if (!stopped && !e.wasClean) onError?.('Overshoot connection closed unexpectedly');
    };
  }

  init().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : 'Overshoot init failed';
    console.error('[Overshoot]', msg);
    onError?.(msg);
  });

  return () => {
    stopped = true;
    if (keepaliveId) clearInterval(keepaliveId);
    try { ws?.close(); } catch { /* ignore */ }
    try { pc?.close(); } catch { /* ignore */ }
  };
}
