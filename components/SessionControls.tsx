'use client';

import { useCoachingStore } from '@/lib/coaching-store';

interface Props {
  onStart: () => void;
  onStop: () => void;
  disabled?: boolean;
  processing?: boolean;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function SessionControls({ onStart, onStop, disabled, processing }: Props) {
  const { isSessionActive } = useCoachingStore();

  if (processing) return null;

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        disabled={disabled}
        onClick={isSessionActive ? onStop : onStart}
        className={`px-8 py-3 rounded-xl font-semibold text-sm transition-colors disabled:bg-gray-700 disabled:cursor-not-allowed ${
          isSessionActive ? 'bg-red-600 hover:bg-red-500' : 'bg-green-600 hover:bg-green-500'
        }`}
      >
        {isSessionActive ? 'Stop Session' : 'Start Session'}
      </button>
    </div>
  );
}

export { formatTime };
