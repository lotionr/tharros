import type { VisualSignals } from './coaching-store';

const SYSTEM_PROMPT =
  'You are an expert interview coach analyzing a video frame. Return ONLY valid JSON, no other text.';

const USER_PROMPT = `Analyze this interview candidate's body language and return exactly this JSON:
{
  "eye_contact": { "score": <0-10>, "cue": "<coaching cue ≤8 words, or empty>", "fire": <true if score < 5> },
  "posture":     { "score": <0-10>, "cue": "<coaching cue ≤8 words, or empty>", "fire": <true if score < 5> },
  "expression":  { "score": <0-10>, "cue": "<coaching cue ≤8 words, or empty>", "fire": <true if score < 6> },
  "pacing":      { "score": <0-10>, "cue": "<coaching cue ≤8 words, or empty>", "fire": <true if score < 4 or score > 9> }
}`;

export type SignalFireCallback = (key: string, cue: string) => void;
export type SignalsUpdateCallback = (signals: VisualSignals) => void;
export type OvershootErrorCallback = (msg: string) => void;

export function startOvershootLoop(
  videoEl: HTMLVideoElement,
  onSignalFire: SignalFireCallback,
  onSignalsUpdate: SignalsUpdateCallback,
  onError?: OvershootErrorCallback
): () => void {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext('2d')!;
  const apiKey = process.env.NEXT_PUBLIC_OVERSHOOT_API_KEY ?? '';

  let consecutiveErrors = 0;

  const intervalId = setInterval(async () => {
    if (videoEl.readyState < 2) return;

    try {
      ctx.drawImage(videoEl, 0, 0, 640, 480);
      const base64 = canvas.toDataURL('image/jpeg', 0.7).split(',')[1];

      const res = await fetch('https://api.overshoot.tv/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'overshoot-vision',
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role: 'user',
              content: [
                { type: 'text', text: USER_PROMPT },
                { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
              ],
            },
          ],
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        throw new Error(`Overshoot ${res.status}: ${errText}`);
      }

      const raw = await res.json();
      const text: string =
        raw?.choices?.[0]?.message?.content ?? raw?.content ?? JSON.stringify(raw);

      // Strip markdown fences if present
      const jsonText = text.replace(/```(?:json)?/g, '').trim();
      const signals: VisualSignals = JSON.parse(jsonText);

      consecutiveErrors = 0;
      onSignalsUpdate(signals);

      const keys = ['eye_contact', 'posture', 'expression', 'pacing'] as const;
      for (const key of keys) {
        const sig = signals[key];
        if (sig?.fire && sig?.cue) {
          onSignalFire(key, sig.cue);
        }
      }
    } catch (err: unknown) {
      consecutiveErrors++;
      const msg = err instanceof Error ? err.message : 'Overshoot error';
      console.error('[Overshoot]', msg);
      // Only surface to UI on first error, not on every frame
      if (consecutiveErrors === 1) {
        onError?.(msg);
      }
    }
  }, 800);

  return () => clearInterval(intervalId);
}
