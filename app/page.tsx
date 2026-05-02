'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useCoachingStore } from '@/lib/coaching-store';
import { startOvershootLoop } from '@/lib/overshoot';
import {
  openElevenLabsSocket,
  closeElevenLabsSocket,
  initDebounceEngine,
  onSignalFire,
} from '@/lib/elevenlabs';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function Home() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const overshootStopRef = useRef<(() => void) | null>(null);
  const uploadIdRef = useRef<string | null>(null);

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [processing, setProcessing] = useState(false);

  const {
    isSessionActive,
    setSessionActive,
    resetSession,
    setCurrentSignals,
    addChapterCue,
  } = useCoachingStore();

  // Camera init on mount
  useEffect(() => {
    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        streamRef.current = stream;
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
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Poll Mux until asset is ready, then redirect
  const pollMuxAsset = useCallback(
    (uploadId: string) => {
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/mux-asset?uploadId=${uploadId}`);
          const data = await res.json();
          if (data.status === 'ready' && data.playbackId) {
            clearInterval(pollRef.current!);
            router.push(`/playback?playbackId=${data.playbackId}`);
          }
        } catch {
          // keep polling
        }
      }, 3000);
    },
    [router]
  );

  const startSession = useCallback(async () => {
    resetSession();
    setElapsed(0);
    setProcessing(false);

    const now = Date.now();

    // Get Mux upload URL
    try {
      const res = await fetch('/api/mux-upload', { method: 'POST' });
      const { uploadId } = await res.json();
      uploadIdRef.current = uploadId ?? null;
    } catch {
      uploadIdRef.current = null;
    }

    setSessionActive(true, now);

    // Init debounce engine + ElevenLabs
    initDebounceEngine(now, addChapterCue);
    const voiceId = process.env.NEXT_PUBLIC_ELEVENLABS_VOICE_ID ?? '';
    const elKey = process.env.NEXT_PUBLIC_ELEVENLABS_API_KEY ?? '';
    if (voiceId && elKey) openElevenLabsSocket(voiceId, elKey);

    // Start Overshoot frame loop
    if (videoRef.current) {
      overshootStopRef.current = startOvershootLoop(
        videoRef.current,
        onSignalFire,
        setCurrentSignals
      );
    }

    // Start elapsed timer
    timerRef.current = setInterval(() => {
      setElapsed((s) => s + 1);
    }, 1000);
  }, [resetSession, setSessionActive, setCurrentSignals, addChapterCue]);

  const stopSession = useCallback(() => {
    // Stop Overshoot loop
    overshootStopRef.current?.();
    overshootStopRef.current = null;

    // Stop ElevenLabs
    closeElevenLabsSocket();

    // Stop timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    setSessionActive(false);
    setProcessing(true);

    // Start polling Mux for asset readiness
    if (uploadIdRef.current) {
      pollMuxAsset(uploadIdRef.current);
    } else {
      setProcessing(false);
    }
  }, [setSessionActive, pollMuxAsset]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      overshootStopRef.current?.();
      closeElevenLabsSocket();
      if (timerRef.current) clearInterval(timerRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  return (
    <main className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-6">
      <h1 className="text-3xl font-bold mb-2 tracking-tight">Tharros</h1>
      <p className="text-gray-400 mb-8 text-sm">Real-time AI Interview Coach</p>

      {/* Webcam */}
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

            {/* Timer overlay */}
            {isSessionActive && (
              <div className="absolute top-3 right-3 bg-black/60 backdrop-blur-sm rounded-lg px-3 py-1 text-sm font-mono text-green-400">
                {formatTime(elapsed)}
              </div>
            )}

            {/* Processing overlay */}
            {processing && (
              <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
                <p className="text-white text-lg font-semibold">Processing…</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Controls */}
      <div className="mt-6 flex flex-col items-center gap-2">
        {!processing && (
          <button
            disabled={!cameraReady || !!cameraError}
            onClick={isSessionActive ? stopSession : startSession}
            className={`px-8 py-3 rounded-xl font-semibold text-sm transition-colors disabled:bg-gray-700 disabled:cursor-not-allowed ${
              isSessionActive
                ? 'bg-red-600 hover:bg-red-500'
                : 'bg-green-600 hover:bg-green-500'
            }`}
          >
            {isSessionActive ? 'Stop Session' : 'Start Session'}
          </button>
        )}
        {isSessionActive && (
          <p className="text-gray-500 text-xs">Session active — {formatTime(elapsed)}</p>
        )}
      </div>
    </main>
  );
}
