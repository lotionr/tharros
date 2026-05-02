import { NextResponse } from 'next/server';

export async function POST() {
  const tokenId = process.env.MUX_TOKEN_ID;
  const tokenSecret = process.env.MUX_TOKEN_SECRET;

  if (!tokenId || !tokenSecret) {
    return NextResponse.json({ error: 'Mux credentials not configured' }, { status: 500 });
  }

  const credentials = Buffer.from(`${tokenId}:${tokenSecret}`).toString('base64');

  const res = await fetch('https://api.mux.com/video/v1/uploads', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      cors_origin: '*',
      new_asset_settings: { playback_policy: ['public'] },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json({ error: text }, { status: res.status });
  }

  const data = await res.json();
  return NextResponse.json({
    uploadUrl: data.data.url,
    uploadId: data.data.id,
  });
}
