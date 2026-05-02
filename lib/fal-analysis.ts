import type { ReportCard } from './coaching-store';

export async function analyzeSession(playbackId: string): Promise<ReportCard> {
  const res = await fetch('/api/fal-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: 'openrouter/router/video',
      input: {
        video_urls: [`https://stream.mux.com/${playbackId}.m3u8`],
        model: 'google/gemini-2.5-flash',
        system_prompt:
          'You are a professional interview coach. Be specific and constructive. Return only valid JSON, no other text.',
        prompt: `Analyze this interview practice session. Return exactly this JSON:
{"overall_score":<1-10>,"confidence_rating":"<Poor|Fair|Good|Strong>","top_strengths":["<strength 1>","<strength 2>"],"top_improvements":["<improvement 1>","<improvement 2>"],"summary":"<2-3 sentence coaching summary>"}`,
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`fal-proxy error: ${res.status}`);
  }

  const raw = await res.json();

  // raw.output is the model's text — strip markdown fences if present
  const text: string = (raw.output ?? raw.choices?.[0]?.message?.content ?? JSON.stringify(raw))
    .replace(/```(?:json)?/g, '')
    .trim();

  return JSON.parse(text) as ReportCard;
}
