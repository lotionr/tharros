'use client';

import { useEffect, useRef, useState } from 'react';

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;

    async function startCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setCameraReady(true);
        }
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError'
              ? 'Camera permission denied. Please allow camera access and reload.'
              : `Camera error: ${err.message}`
            : 'Unknown camera error.';
        setCameraError(message);
      }
    }

    startCamera();

    return () => {
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <main className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-6">
      <h1 className="text-3xl font-bold mb-6 tracking-tight">Tharros</h1>
      <p className="text-gray-400 mb-8 text-sm">Real-time AI Interview Coach</p>

      <div className="relative w-full max-w-2xl aspect-video bg-gray-900 rounded-2xl overflow-hidden shadow-2xl">
        {cameraError ? (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <p className="text-red-400 text-center text-sm">{cameraError}</p>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              autoPlay
              playsInline
              muted
            />
            {!cameraReady && (
              <div className="absolute inset-0 flex items-center justify-center">
                <p className="text-gray-500 text-sm">Starting camera…</p>
              </div>
            )}
          </>
        )}
      </div>

      <div className="mt-6">
        <button
          disabled
          className="px-8 py-3 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-xl font-semibold text-sm transition-colors"
        >
          Start Session
        </button>
      </div>
    </main>
  );
}
