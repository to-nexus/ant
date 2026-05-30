import { StateCreator } from 'zustand';
import type {
  FeatureDeletionPhase,
  FeatureDeletionErrorShape,
} from '@ant/shared';
import type { FeatureDeletionSession, FeatureDeletionPhaseSnapshot } from '../types';
import { selectFailedPhase } from '@/presentation/components/common/async/PhasedOperationSession';

/**
 * Tracks the in-flight feature deletion so the FE can render a step rail +
 * structured error popup. Mirrors `projectDeletionSlice` over the feature
 * scope — only one feature deletion may be active at a time; starting a
 * second one replaces the session.
 *
 * Failure carries the structured `FeatureDeletionErrorShape` from the BE
 * so the panel can show stage / hint / leftovers / Force Delete CTA / cid.
 */
export interface FeatureDeletionSliceState {
  featureDeletionSession: FeatureDeletionSession;
}

export interface FeatureDeletionActions {
  startFeatureDeletion: (projectId: string, featureName: string) => void;
  updateFeatureDeletionPhase: (
    phase: FeatureDeletionPhase,
    status: 'active' | 'complete' | 'failed',
  ) => void;
  markFeatureDeletionComplete: () => void;
  markFeatureDeletionFailed: (shape: FeatureDeletionErrorShape, correlationId: string) => void;
  resetFeatureDeletionSession: () => void;
}

export type FeatureDeletionSlice = FeatureDeletionSliceState & FeatureDeletionActions;

export const createFeatureDeletionSlice: StateCreator<FeatureDeletionSlice> = (set, get) => ({
  featureDeletionSession: { kind: 'idle' },

  startFeatureDeletion: (projectId, featureName) => {
    set({
      featureDeletionSession: {
        kind: 'deleting',
        projectId,
        featureName,
        phase: null,
        startedAt: Date.now(),
        phaseHistory: [],
      },
    });
  },

  updateFeatureDeletionPhase: (phase, status) => {
    const current = get().featureDeletionSession;
    if (current.kind !== 'deleting') return; // stale event after completion/cancel — drop

    let nextPhase: FeatureDeletionPhase | null = current.phase;
    const nextHistory: FeatureDeletionPhaseSnapshot[] = [...current.phaseHistory];

    if (status === 'active') {
      nextPhase = phase;
    } else if (status === 'complete') {
      nextPhase = phase;
      const filtered = nextHistory.filter((s) => s.phase !== phase);
      filtered.push({ phase, status: 'complete' });
      nextHistory.length = 0;
      nextHistory.push(...filtered);
    } else if (status === 'failed') {
      nextPhase = phase;
      const filtered = nextHistory.filter((s) => s.phase !== phase);
      filtered.push({ phase, status: 'failed' });
      nextHistory.length = 0;
      nextHistory.push(...filtered);
    }

    set({
      featureDeletionSession: {
        ...current,
        phase: nextPhase,
        phaseHistory: nextHistory,
      },
    });
  },

  markFeatureDeletionComplete: () => {
    const current = get().featureDeletionSession;
    if (current.kind !== 'deleting') return;
    set({
      featureDeletionSession: {
        kind: 'completed',
        projectId: current.projectId,
        featureName: current.featureName,
        completedAt: Date.now(),
      },
    });
  },

  markFeatureDeletionFailed: (shape, correlationId) => {
    const current = get().featureDeletionSession;
    const projectId = current.kind !== 'idle' ? current.projectId : '';
    const featureName = current.kind !== 'idle' ? current.featureName : '';
    set({
      featureDeletionSession: {
        kind: 'failed',
        projectId,
        featureName,
        stage: shape.stage,
        message: shape.message,
        ...(shape.hint !== undefined ? { hint: shape.hint } : {}),
        ...(shape.leftovers !== undefined ? { leftovers: shape.leftovers } : {}),
        canForceCleanup: shape.canForceCleanup,
        correlationId,
      },
    });
  },

  resetFeatureDeletionSession: () => {
    set({ featureDeletionSession: { kind: 'idle' } });
  },
});

/**
 * Derive the failed phase from a deleting-session's history (or directly
 * from a failed session). Delegates to the generic `selectFailedPhase`.
 */
export function selectFeatureDeletionFailedPhase(
  s: { featureDeletionSession: FeatureDeletionSession },
): FeatureDeletionPhase | null {
  return selectFailedPhase(s.featureDeletionSession);
}
