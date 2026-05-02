'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useCoachingStore } from '@/lib/coaching-store';
import { startOvershootLoop } from '@/lib/overshoot';
import { startWhisperPipeline } from '@/lib/fal-whisper';
import { startMuxRecording, type MuxSession } from '@/lib/mux';
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
  const whisperStopRef = useRef<(() => void) | null>(null);
  const muxSessionRef = useRef<MuxSession | null>(null);

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const [overshootError, setOvershootError] = useState<string | null>(null);

  const {
    isSessionActive,
    setSessionActive,
    resetSession,
    setCurrentSignals,
    setLatestTranscript,
    incrementFillerCount,
    addChapterCue,
    addCueLog,
    currentSignals,
    latestTranscript,
    fillerCount,
    cueLog,
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
    if (!streamRef.current) return;
    resetSession();
    setElapsed(0);
    setProcessing(false);

    const now = Date.now();

    // Start Mux recording (primary video+audio recorder)
    try {
      muxSessionRef.current = await startMuxRecording(streamRef.current);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Mux recording failed';
      setErrorToast(`Recording error: ${msg}`);
      setTimeout(() => setErrorToast(null), 6000);
      // Continue session without recording — coaching still works
    }

    setSessionActive(true, now);

    // Init debounce engine + ElevenLabs
    initDebounceEngine(now, addChapterCue, addCueLog);
    const voiceId = process.env.NEXT_PUBLIC_ELEVENLABS_VOICE_ID ?? '';
    const elKey = process.env.NEXT_PUBLIC_ELEVENLABS_API_KEY ?? '';
    if (voiceId && elKey) openElevenLabsSocket(voiceId, elKey);

    // Start Overshoot stream
    setOvershootError(null);
    overshootStopRef.current = startOvershootLoop(
      streamRef.current,
      onSignalFire,
      setCurrentSignals,
      (msg) => setOvershootError(msg)
    );

    // Start Whisper audio pipeline
    whisperStopRef.current = startWhisperPipeline(
      streamRef.current,
      onSignalFire,
      (text, fillers) => {
        setLatestTranscript(text);
        if (fillers.length > 0) incrementFillerCount(fillers.length);
      },
      (msg) => {
        setErrorToast(msg);
        setTimeout(() => setErrorToast(null), 5000);
      }
    );

    // Start elapsed timer
    timerRef.current = setInterval(() => {
      setElapsed((s) => s + 1);
    }, 1000);
  }, [resetSession, setSessionActive, setCurrentSignals, addChapterCue, addCueLog, setLatestTranscript, incrementFillerCount]);

  const stopSession = useCallback(async () => {
    overshootStopRef.current?.();
    overshootStopRef.current = null;
    whisperStopRef.current?.();
    whisperStopRef.current = null;
    closeElevenLabsSocket();

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    setSessionActive(false);
    setProcessing(true);

    const mux = muxSessionRef.current;
    muxSessionRef.current = null;
    if (mux) {
      await mux.stop(); // finalize upload
      pollMuxAsset(mux.uploadId);
    } else {
      setProcessing(false);
    }
  }, [setSessionActive, pollMuxAsset]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      overshootStopRef.current?.();
      whisperStopRef.current?.();
      muxSessionRef.current?.stop().catch(() => {});
      closeElevenLabsSocket();
      if (timerRef.current) clearInterval(timerRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Render last 10 words of transcript with fillers highlighted
  const transcriptWords = latestTranscript.trim().split(/\s+/).filter(Boolean).slice(-10);

  return (
    <main className="min-h-screen bg-gray-950 text-white flex flex-col items-center p-6 pt-10">
      <h1 className="text-3xl font-bold mb-1 tracking-tight">Tharros</h1>
      <p className="text-gray-400 mb-6 text-sm">Real-time AI Interview Coach</p>

      {/* Webcam */}
      <div className="relative w-full max-w-2xl aspect-video bg-gray-900 rounded-2xl overflow-hidden shadow-2xl">
        {cameraError ? (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <p className="text-red-400 text-center text-sm">{cameraError}</p>
          </div>
        ) : (
          <>
            <video ref={videoRef} className="w-full h-full object-cover" autoPlay playsInline muted />
            {!cameraReady && (
              <div className="absolute inset-0 flex items-center justify-center">
                <p className="text-gray-500 text-sm">Starting camera…</p>
              </div>
            )}

            {/* Overshoot error badge */}
            {isSessionActive && overshootError && !currentSignals && (
              <div className="absolute top-3 left-3 px-2 py-1 rounded-md text-xs bg-red-900/80 text-red-300 backdrop-blur-sm max-w-[200px]">
                Overshoot: {overshootError}
              </div>
            )}

            {/* Live signal badges */}
            {isSessionActive && currentSignals && (
              <div className="absolute top-3 left-3 flex flex-col gap-1">
                {(['eye_contact', 'posture', 'expression', 'pacing'] as const).map((key) => {
                  const sig = currentSignals[key];
                  const color = sig.score >= 7
                    ? 'bg-black/60 text-green-400'
                    : sig.score >= 4
                    ? 'bg-yellow-500/70 text-white'
                    : 'bg-red-500/80 text-white';
                  return (
                    <div
                      key={key}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-mono backdrop-blur-sm ${color}`}
                    >
                      <span className="capitalize">{key.replace('_', ' ')}</span>
                      <span className="font-bold">{sig.score}/10</span>
                    </div>
                  );
                })}
                {fillerCount > 0 && (
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-mono bg-amber-500/80 text-white backdrop-blur-sm">
                    <span>Fillers</span>
                    <span className="font-bold">{fillerCount}</span>
                  </div>
                )}
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
      <div className="mt-5 flex flex-col items-center gap-2">
        {!processing && (
          <button
            disabled={!cameraReady || !!cameraError}
            onClick={isSessionActive ? stopSession : startSession}
            className={`px-8 py-3 rounded-xl font-semibold text-sm transition-colors disabled:bg-gray-700 disabled:cursor-not-allowed ${
              isSessionActive ? 'bg-red-600 hover:bg-red-500' : 'bg-green-600 hover:bg-green-500'
            }`}
          >
            {isSessionActive ? 'Stop Session' : 'Start Session'}
          </button>
        )}
        {isSessionActive && (
          <p className="text-gray-500 text-xs">Session active — {formatTime(elapsed)}</p>
        )}
      </div>

      {/* Live transcript strip */}
      {isSessionActive && transcriptWords.length > 0 && (
        <div className="mt-4 w-full max-w-2xl bg-gray-900 rounded-xl px-4 py-2 text-sm">
          <span className="text-gray-500 text-xs mr-2">Transcript:</span>
          {transcriptWords.map((word, i) => {
            const clean = word.toLowerCase().replace(/[^a-z]/g, '');
            const isFiller = ['um', 'uh', 'like', 'so', 'basically', 'literally'].includes(clean)
              || word.toLowerCase().includes('you know');
            return (
              <span key={i} className={isFiller ? 'text-amber-400 font-semibold' : 'text-gray-200'}>
                {word}{' '}
              </span>
            );
          })}
        </div>
      )}

      {/* Error toast */}
      {errorToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-red-900 border border-red-600 text-red-200 text-sm px-4 py-3 rounded-xl shadow-xl flex items-center gap-3 z-50">
          <span>{errorToast}</span>
          <button onClick={() => setErrorToast(null)} className="text-red-400 hover:text-white">✕</button>
        </div>
      )}

      {/* Cue log */}
      {isSessionActive && cueLog.length > 0 && (
        <div className="mt-3 w-full max-w-2xl bg-gray-900 rounded-xl px-4 py-2">
          <p className="text-gray-500 text-xs mb-1">Recent cues</p>
          {cueLog.slice(-5).map((entry, i) => (
            <p key={i} className="text-xs text-gray-300">
              <span className="text-gray-500">{new Date(entry.time).toLocaleTimeString([], { timeStyle: 'medium' })}</span>
              {' · '}
              <span className="text-green-400">{entry.signal}</span>
              {' — '}
              {entry.cue}
            </p>
          ))}
        </div>
      )}
    </main>
  );
}
