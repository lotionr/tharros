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
  if (!apiKey) {
    const msg = 'NEXT_PUBLIC_OVERSHOOT_API_KEY not set';
    console.error('[Overshoot]', msg);
    onError?.(msg);
    return () => {};
  }

  console.log('[Overshoot] init — API_URL:', API_URL, 'key prefix:', apiKey.slice(0, 8));

  // Use the same TURN servers the SDK uses internally — required for WebRTC relay through NAT
  const ICE_SERVERS: RTCIceServer[] = [
    { urls: 'turn:turn.overshoot.ai:3478?transport=udp', username: '1769538895:c66a907c-61f4-4ec2-93a6-9d6b932776bb', credential: 'Fu9L4CwyYZvsOLc+23psVAo3i/Y=' },
    { urls: 'turn:turn.overshoot.ai:3478?transport=tcp', username: '1769538895:c66a907c-61f4-4ec2-93a6-9d6b932776bb', credential: 'Fu9L4CwyYZvsOLc+23psVAo3i/Y=' },
    { urls: 'turns:turn.overshoot.ai:443?transport=udp', username: '1769538895:c66a907c-61f4-4ec2-93a6-9d6b932776bb', credential: 'Fu9L4CwyYZvsOLc+23psVAo3i/Y=' },
  ];

  const client = new StreamClient({ baseUrl: API_URL, apiKey });
  let pc: RTCPeerConnection | null = null;
  let ws: WebSocket | null = null;
  let keepaliveId: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  async function init() {
    const videoTracks = stream.getVideoTracks();
    console.log('[Overshoot] video tracks:', videoTracks.length, videoTracks[0]?.label);
    if (!videoTracks[0]) throw new Error('No video track in stream');

    pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pc.addTrack(videoTracks[0], stream);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    console.log('[Overshoot] ICE gathering started, state:', pc.iceGatheringState);

    // Wait for ICE gathering to complete (null candidate = done)
    await new Promise<void>((resolve) => {
      if (pc!.iceGatheringState === 'complete') { resolve(); return; }
      pc!.onicecandidate = (e) => {
        console.log('[Overshoot] ICE candidate:', e.candidate ? e.candidate.type : 'null (done)');
        if (e.candidate === null) resolve();
      };
      setTimeout(() => { console.log('[Overshoot] ICE timeout fallback'); resolve(); }, 3000);
    });

    if (stopped) return;
    console.log('[Overshoot] ICE done, calling createStream...');

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

    console.log('[Overshoot] stream created, id:', response.stream_id);
    await pc.setRemoteDescription(response.webrtc);
    console.log('[Overshoot] remote description set, connecting WebSocket...');

    if (stopped) return;

    keepaliveId = setInterval(() => {
      client.renewLease(response.stream_id).catch((e: unknown) => {
        console.warn('[Overshoot] keepalive failed:', e);
      });
    }, 60_000);

    ws = client.connectWebSocket(response.stream_id);

    ws.onopen = () => {
      console.log('[Overshoot] WebSocket open, authenticating...');
      ws!.send(JSON.stringify({ api_key: apiKey }));
    };

    ws.onmessage = (event) => {
      if (stopped) return;
      try {
        const msg = JSON.parse(event.data as string);
        console.log('[Overshoot] message ok:', msg.ok, 'result:', msg.result?.slice(0, 80));
        if (!msg.ok || !msg.result) return;
        const signals: VisualSignals = JSON.parse(msg.result);
        onSignalsUpdate(signals);
        for (const key of SIGNAL_KEYS) {
          const sig = signals[key];
          if (sig?.fire && sig?.cue) onSignalFire(key, sig.cue);
        }
      } catch (e) {
        console.warn('[Overshoot] parse error:', e);
      }
    };

    ws.onerror = (e) => {
      console.error('[Overshoot] WebSocket error', e);
      onError?.('Overshoot WebSocket error');
    };

    ws.onclose = (e) => {
      console.log('[Overshoot] WebSocket closed — code:', e.code, 'clean:', e.wasClean, 'reason:', e.reason);
      if (!stopped && !e.wasClean) onError?.(`Overshoot disconnected (${e.code})`);
    };
  }

  init().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : 'Overshoot init failed';
    console.error('[Overshoot] init error:', msg);
    onError?.(msg);
  });

  return () => {
    stopped = true;
    if (keepaliveId) clearInterval(keepaliveId);
    try { ws?.close(); } catch { /* ignore */ }
    try { pc?.close(); } catch { /* ignore */ }
  };
}
