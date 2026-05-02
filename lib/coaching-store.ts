import { create } from 'zustand';

export interface VisualSignals {
  eye_contact: { score: number; cue: string; fire: boolean };
  posture: { score: number; cue: string; fire: boolean };
  expression: { score: number; cue: string; fire: boolean };
  pacing: { score: number; cue: string; fire: boolean };
}

export interface ReportCard {
  overall_score: number;
  confidence_rating: 'Poor' | 'Fair' | 'Good' | 'Strong';
  top_strengths: string[];
  top_improvements: string[];
  summary: string;
}

export interface CueLogEntry {
  time: number;
  signal: string;
  cue: string;
}

export interface ChapterCue {
  startTime: number;
  endTime: number;
  value: string;
}

interface CoachingState {
  isSessionActive: boolean;
  sessionStartTime: number | null;
  currentSignals: VisualSignals | null;
  latestTranscript: string;
  fillerCount: number;
  cueLog: CueLogEntry[];
  chapterCues: ChapterCue[];
  reportCard: ReportCard | null;
  muxAssetId: string | null;
  muxPlaybackId: string | null;

  setSessionActive: (active: boolean, startTime?: number) => void;
  setCurrentSignals: (signals: VisualSignals) => void;
  setLatestTranscript: (transcript: string) => void;
  incrementFillerCount: (count: number) => void;
  addCueLog: (entry: CueLogEntry) => void;
  addChapterCue: (cue: ChapterCue) => void;
  setReportCard: (card: ReportCard) => void;
  setMuxIds: (assetId: string, playbackId: string) => void;
  resetSession: () => void;
}

export const useCoachingStore = create<CoachingState>((set) => ({
  isSessionActive: false,
  sessionStartTime: null,
  currentSignals: null,
  latestTranscript: '',
  fillerCount: 0,
  cueLog: [],
  chapterCues: [],
  reportCard: null,
  muxAssetId: null,
  muxPlaybackId: null,

  setSessionActive: (active, startTime) =>
    set({ isSessionActive: active, sessionStartTime: startTime ?? null }),

  setCurrentSignals: (signals) => set({ currentSignals: signals }),

  setLatestTranscript: (transcript) => set({ latestTranscript: transcript }),

  incrementFillerCount: (count) =>
    set((state) => ({ fillerCount: state.fillerCount + count })),

  addCueLog: (entry) =>
    set((state) => ({ cueLog: [...state.cueLog.slice(-49), entry] })),

  addChapterCue: (cue) =>
    set((state) => ({ chapterCues: [...state.chapterCues, cue] })),

  setReportCard: (card) => set({ reportCard: card }),

  setMuxIds: (assetId, playbackId) =>
    set({ muxAssetId: assetId, muxPlaybackId: playbackId }),

  resetSession: () =>
    set({
      isSessionActive: false,
      sessionStartTime: null,
      currentSignals: null,
      latestTranscript: '',
      fillerCount: 0,
      cueLog: [],
      chapterCues: [],
      reportCard: null,
      muxAssetId: null,
      muxPlaybackId: null,
    }),
}));
