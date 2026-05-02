import { fal } from '@fal-ai/client';
import { NextRequest, NextResponse } from 'next/server';

const FAL_KEY = process.env.FAL_KEY;
const MOCK_MODE = !FAL_KEY || FAL_KEY.startsWith('REPLACE_ME');

if (!MOCK_MODE) {
  fal.config({ credentials: FAL_KEY });
}

// ── Mock responses (used when FAL_KEY is not set) ─────────────────────────────

const FILLER_SENTENCES = [
  'So um I think like the main thing is you know being prepared',
  'Basically um I would say uh my biggest strength is adaptability',
  'Like I have um you know five years of experience in this field',
  'I um literally love working in fast-paced environments you know',
  'So basically uh the project was like a huge success',
];
let fillerIndex = 0;

function mockWizper() {
  const text = FILLER_SENTENCES[fillerIndex % FILLER_SENTENCES.length];
  fillerIndex++;
  return { text, chunks: text.split(' ').map((w, i) => ({ word: w, start: i * 0.3, end: i * 0.3 + 0.25 })) };
}

function mockGeminiReport() {
  return {
    output: JSON.stringify({
      overall_score: 7,
      confidence_rating: 'Good',
      top_strengths: [
        'Maintained good eye contact throughout',
        'Clear and structured responses',
      ],
      top_improvements: [
        'Reduce filler words like "um" and "like"',
        'Slow down slightly when making key points',
      ],
      summary:
        'You demonstrated solid communication skills and stayed composed under pressure. Focus on reducing filler words to sound more polished — your content is strong, the delivery just needs refinement.',
    }),
  };
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') ?? '';

    // Handle file upload (FormData with a 'file' field)
    if (contentType.includes('multipart/form-data')) {
      if (MOCK_MODE) {
        return NextResponse.json({ url: 'https://mock-fal-storage/audio.webm' });
      }
      const form = await req.formData();
      const file = form.get('file') as File | null;
      if (!file) {
        return NextResponse.json({ error: 'No file provided' }, { status: 400 });
      }
      const url = await fal.storage.upload(file);
      return NextResponse.json({ url });
    }

    // Standard JSON proxy: { endpoint, input }
    const { endpoint, input } = await req.json();

    if (MOCK_MODE) {
      if (endpoint === 'fal-ai/wizper') return NextResponse.json(mockWizper());
      if (endpoint.includes('openrouter')) return NextResponse.json(mockGeminiReport());
      return NextResponse.json({ error: 'FAL_KEY not set — mock mode only supports wizper and openrouter' }, { status: 501 });
    }

    const result = await fal.subscribe(endpoint, { input });
    return NextResponse.json(result.data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
