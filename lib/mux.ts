// Mux Direct Upload — primary MediaRecorder (video+audio → Mux)
// Runs independently of the Whisper audio-only recorder.

export interface MuxSession {
  uploadId: string;
  stop: () => Promise<void>;
}

export async function startMuxRecording(stream: MediaStream): Promise<MuxSession | null> {
  // Get upload URL from server
  let uploadUrl: string;
  let uploadId: string;

  try {
    const res = await fetch('/api/mux-upload', { method: 'POST' });
    if (!res.ok) throw new Error('mux-upload failed');
    const data = await res.json();
    uploadUrl = data.uploadUrl;
    uploadId = data.uploadId;
  } catch {
    return null;
  }

  // Choose best supported mimeType
  const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    .find((m) => MediaRecorder.isTypeSupported(m)) ?? '';

  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  // Start recording — collect data every 2s for streaming upload
  recorder.start(2000);

  const stop = (): Promise<void> =>
    new Promise((resolve) => {
      recorder.onstop = async () => {
        if (chunks.length === 0) { resolve(); return; }
        const blob = new Blob(chunks, { type: mimeType || 'video/webm' });
        try {
          await fetch(uploadUrl, {
            method: 'PUT',
            body: blob,
            headers: { 'Content-Type': blob.type },
          });
        } catch {
          // Upload failed — continue anyway
        }
        resolve();
      };
      recorder.stop();
    });

  return { uploadId, stop };
}
