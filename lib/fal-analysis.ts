import type { ReportCard } from './coaching-store';

export async function analyzeSession(playbackId: string, mp4Url?: string): Promise<ReportCard> {
  const videoUrl = mp4Url ?? `https://stream.mux.com/${playbackId}/high.mp4`;
  const res = await fetch('/api/fal-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: 'openrouter/router/video',
      input: {
        video_url: videoUrl,
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
  console.log('[fal-analysis] raw response:', JSON.stringify(raw).slice(0, 500));

  // raw.output is the model's text — strip markdown fences if present
  const text: string = (raw.output ?? raw.choices?.[0]?.message?.content ?? JSON.stringify(raw))
    .replace(/```(?:json)?/g, '')
    .trim();

  console.log('[fal-analysis] parsed text:', text.slice(0, 300));
  try {
    return JSON.parse(text) as ReportCard;
  } catch {
    console.error('[fal-analysis] JSON.parse failed. Raw text:', text.slice(0, 300));
    return {
      overall_score: 0,
      confidence_rating: 'Poor',
      top_strengths: [],
      top_improvements: ['Analysis could not be parsed — please try again.'],
      summary: 'The AI coach could not generate a report for this session.',
    } as ReportCard;
  }
}
