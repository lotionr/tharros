import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const uploadId = req.nextUrl.searchParams.get('uploadId');
  if (!uploadId) {
    return NextResponse.json({ error: 'uploadId required' }, { status: 400 });
  }

  const tokenId = process.env.MUX_TOKEN_ID;
  const tokenSecret = process.env.MUX_TOKEN_SECRET;

  if (!tokenId || !tokenSecret) {
    return NextResponse.json({ error: 'Mux credentials not configured' }, { status: 500 });
  }

  const credentials = Buffer.from(`${tokenId}:${tokenSecret}`).toString('base64');

  // First get the upload to find the asset ID
  const uploadRes = await fetch(`https://api.mux.com/video/v1/uploads/${uploadId}`, {
    headers: { Authorization: `Basic ${credentials}` },
  });

  if (!uploadRes.ok) {
    const text = await uploadRes.text();
    return NextResponse.json({ error: text }, { status: uploadRes.status });
  }

  const uploadData = await uploadRes.json();
  const assetId: string | undefined = uploadData.data.asset_id;

  if (!assetId) {
    return NextResponse.json({ status: 'waiting', assetId: null, playbackId: null });
  }

  // Fetch the asset to get playback ID and status
  const assetRes = await fetch(`https://api.mux.com/video/v1/assets/${assetId}`, {
    headers: { Authorization: `Basic ${credentials}` },
  });

  if (!assetRes.ok) {
    const text = await assetRes.text();
    return NextResponse.json({ error: text }, { status: assetRes.status });
  }

  const assetData = await assetRes.json();
  const asset = assetData.data;
  const playbackId: string | undefined = asset.playback_ids?.[0]?.id;
  const mp4Ready = asset.static_renditions?.status === 'ready';
  const mp4Url = mp4Ready && playbackId
    ? `https://stream.mux.com/${playbackId}/high.mp4`
    : null;

  return NextResponse.json({
    status: asset.status,
    assetId,
    playbackId: playbackId ?? null,
    mp4Url,
  });
}
