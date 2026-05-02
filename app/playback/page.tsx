'use client';

import { useEffect, useState, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useCoachingStore } from '@/lib/coaching-store';
import { analyzeSession } from '@/lib/fal-analysis';
import type { ChapterCue, ReportCard } from '@/lib/coaching-store';
import { Suspense } from 'react';
import MuxPlayer from '@mux/mux-player-react';

function PlaybackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const playbackId = searchParams.get('playbackId') ?? '';

  const { chapterCues, reportCard, setReportCard, cueLog } = useCoachingStore();

  const [localReport, setLocalReport] = useState<ReportCard | null>(reportCard);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const analysisStarted = useRef(false);

  // Run post-session analysis once
  useEffect(() => {
    if (!playbackId || analysisStarted.current || localReport) return;
    analysisStarted.current = true;
    setAnalyzing(true);
    analyzeSession(playbackId)
      .then((report) => {
        setLocalReport(report);
        setReportCard(report);
      })
      .catch((err: unknown) => {
        setAnalysisError(err instanceof Error ? err.message : 'Analysis failed');
      })
      .finally(() => setAnalyzing(false));
  }, [playbackId, localReport, setReportCard]);

  // Calculate total duration for annotation positioning
  const maxTime = chapterCues.length > 0 ? Math.max(...chapterCues.map((c) => c.endTime)) : 0;

  // Count fires per signal
  const signalCounts: Record<string, number> = {};
  for (const entry of cueLog) {
    signalCounts[entry.signal] = (signalCounts[entry.signal] ?? 0) + 1;
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Session Review</h1>
        <button
          onClick={() => router.push('/')}
          className="px-4 py-2 bg-green-700 hover:bg-green-600 rounded-lg text-sm font-semibold transition-colors"
        >
          Start New Session
        </button>
      </div>

      {/* Mux Player */}
      {playbackId ? (
        <div className="w-full rounded-2xl overflow-hidden bg-black mb-4 shadow-2xl">
          <MuxPlayer
            streamType="on-demand"
            playbackId={playbackId}
            envKey={process.env.NEXT_PUBLIC_MUX_ENV_KEY ?? ''}
            style={{ width: '100%', aspectRatio: '16/9' }}
          />
        </div>
      ) : (
        <div className="w-full aspect-video bg-gray-900 rounded-2xl flex items-center justify-center mb-4">
          <p className="text-gray-500 text-sm">No recording available</p>
        </div>
      )}

      {/* Chapter cue annotation bar */}
      {chapterCues.length > 0 && maxTime > 0 && (
        <div className="mb-6">
          <p className="text-xs text-gray-500 mb-2">Coaching cue timeline</p>
          <div className="relative h-6 bg-gray-800 rounded-full overflow-visible">
            {chapterCues.map((cue, i) => (
              <ChapterDot key={i} cue={cue} maxTime={maxTime} />
            ))}
          </div>
        </div>
      )}

      {/* Signal cue summary */}
      {Object.keys(signalCounts).length > 0 && (
        <div className="mb-6 bg-gray-900 rounded-xl p-4">
          <p className="text-sm font-semibold mb-3 text-gray-300">Cue summary</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(signalCounts).map(([signal, count]) => (
              <span
                key={signal}
                className="px-3 py-1 bg-gray-800 rounded-full text-xs text-gray-300"
              >
                {signal.replace('_', ' ')}: <span className="text-white font-bold">{count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Coaching report card */}
      <div className="bg-gray-900 rounded-xl p-5">
        <p className="text-sm font-semibold mb-4 text-gray-300">AI Coaching Report</p>

        {analyzing && (
          <p className="text-gray-500 text-sm">Analyzing your session with Gemini 2.5 Flash…</p>
        )}

        {analysisError && (
          <p className="text-red-400 text-sm">{analysisError}</p>
        )}

        {localReport && (
          <div className="space-y-4">
            {/* Score + rating */}
            <div className="flex items-center gap-4">
              <div className="text-5xl font-black text-green-400">
                {localReport.overall_score}
                <span className="text-2xl text-gray-500">/10</span>
              </div>
              <div>
                <p className="text-sm font-semibold">{localReport.confidence_rating} Confidence</p>
                <p className="text-xs text-gray-500">Overall performance</p>
              </div>
            </div>

            {/* Strengths */}
            <div>
              <p className="text-xs font-semibold text-green-400 uppercase tracking-wide mb-1">Strengths</p>
              <ul className="space-y-1">
                {localReport.top_strengths.map((s, i) => (
                  <li key={i} className="text-sm text-gray-200 flex gap-2">
                    <span className="text-green-500">✓</span> {s}
                  </li>
                ))}
              </ul>
            </div>

            {/* Improvements */}
            <div>
              <p className="text-xs font-semibold text-amber-400 uppercase tracking-wide mb-1">Improvements</p>
              <ul className="space-y-1">
                {localReport.top_improvements.map((s, i) => (
                  <li key={i} className="text-sm text-gray-200 flex gap-2">
                    <span className="text-amber-500">→</span> {s}
                  </li>
                ))}
              </ul>
            </div>

            {/* Summary */}
            <p className="text-sm text-gray-300 border-t border-gray-800 pt-3">{localReport.summary}</p>
          </div>
        )}

        {!analyzing && !analysisError && !localReport && (
          <p className="text-gray-600 text-sm">No analysis available.</p>
        )}
      </div>
    </main>
  );
}

function ChapterDot({ cue, maxTime }: { cue: ChapterCue; maxTime: number }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const pct = Math.min(100, (cue.startTime / maxTime) * 100);

  const colorMap: Record<string, string> = {
    eye_contact: 'bg-blue-400',
    posture: 'bg-purple-400',
    expression: 'bg-yellow-400',
    pacing: 'bg-orange-400',
    filler_words: 'bg-amber-400',
  };

  const signal = cue.value.split(' — ')[0] ?? 'cue';
  const color = colorMap[signal] ?? 'bg-green-400';

  return (
    <div
      className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 cursor-pointer"
      style={{ left: `${pct}%` }}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <div className={`w-3 h-3 rounded-full ${color} shadow-md`} />
      {showTooltip && (
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs whitespace-nowrap z-10 shadow-xl">
          {cue.value}
          <div className="text-gray-500 mt-0.5">{Math.round(cue.startTime)}s</div>
        </div>
      )}
    </div>
  );
}

export default function Playback() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-950 text-white flex items-center justify-center"><p>Loading…</p></div>}>
      <PlaybackContent />
    </Suspense>
  );
}
