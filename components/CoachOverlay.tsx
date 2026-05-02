'use client';

import { useCoachingStore } from '@/lib/coaching-store';

export default function CoachOverlay() {
  const { currentSignals, fillerCount, isSessionActive } = useCoachingStore();

  if (!isSessionActive) return null;

  const signals = [
    { key: 'eye_contact', label: 'Eye contact' },
    { key: 'posture',     label: 'Posture' },
    { key: 'expression',  label: 'Expression' },
    { key: 'pacing',      label: 'Pacing' },
  ] as const;

  return (
    <div className="flex flex-wrap gap-2">
      {signals.map(({ key, label }) => {
        const sig = currentSignals?.[key];
        const score = sig?.score ?? '—';
        const firing = sig?.fire ?? false;
        return (
          <div
            key={key}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
              firing
                ? 'bg-red-500/20 border-red-500 text-red-300'
                : 'bg-gray-800 border-gray-700 text-gray-300'
            }`}
          >
            {firing && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />}
            {label}
            <span className={firing ? 'text-red-300' : 'text-green-400'}>{score}/10</span>
          </div>
        );
      })}

      {/* Filler words badge */}
      <div
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
          fillerCount > 0
            ? 'bg-amber-500/20 border-amber-500 text-amber-300'
            : 'bg-gray-800 border-gray-700 text-gray-400'
        }`}
      >
        Filler words
        <span className={fillerCount > 0 ? 'text-amber-300' : 'text-gray-500'}>{fillerCount}</span>
      </div>
    </div>
  );
}
