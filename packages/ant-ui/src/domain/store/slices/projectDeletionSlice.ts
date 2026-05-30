import { StateCreator } from 'zustand';
import type {
  ProjectDeletionPhase,
  ProjectDeletionErrorShape,
} from '@ant/shared';
import type { ProjectDeletionSession, ProjectDeletionPhaseSnapshot } from '../types';
import { selectFailedPhase } from '@/presentation/components/common/async/PhasedOperationSession';

/**
 * Tracks the in-flight project deletion so the FE can render a step rail +
 * structured error popup matching the IDE startup UX. Only one deletion may
 * be active at a time; starting a second one replaces the session.
 *
 * State transitions:
 *   idle → deleting (startProjectDeletion)
 *   deleting → deleting (updateProjectDeletionPhase — phase/status change)
 *   deleting → completed (markProjectDeletionComplete)
 *   deleting → failed (markProjectDeletionFailed)
 *   completed/failed → idle (resetProjectDeletionSession)
 *
 * Failure carries the structured `ProjectDeletionErrorShape` from the BE so
 * the panel can show stage / hint / leftovers / Force Delete CTA / cid.
 */
export interface ProjectDeletionSliceState {
  projectDeletionSession: ProjectDeletionSession;
}

export interface ProjectDeletionActions {
  startProjectDeletion: (projectId: string) => void;
  updateProjectDeletionPhase: (
    phase: ProjectDeletionPhase,
    status: 'active' | 'complete' | 'failed',
  ) => void;
  markProjectDeletionComplete: () => void;
  markProjectDeletionFailed: (shape: ProjectDeletionErrorShape, correlationId: string) => void;
  resetProjectDeletionSession: () => void;
}

export type ProjectDeletionSlice = ProjectDeletionSliceState & ProjectDeletionActions;

export const createProjectDeletionSlice: StateCreator<ProjectDeletionSlice> = (set, get) => ({
  projectDeletionSession: { kind: 'idle' },

  startProjectDeletion: (projectId) => {
    set({
      projectDeletionSession: {
        kind: 'deleting',
        projectId,
        phase: null,
        startedAt: Date.now(),
        phaseHistory: [],
      },
    });
  },

  updateProjectDeletionPhase: (phase, status) => {
    const current = get().projectDeletionSession;
    if (current.kind !== 'deleting') return; // stale event after completion/cancel — drop

    // `active`: advance to this phase (don't push to history yet — completion is recorded later).
    // `complete` / `failed`: record in history; for `complete`, also clear current.phase so
    // the rail draws the step as complete (vs. lingering active).
    let nextPhase: ProjectDeletionPhase | null = current.phase;
    const nextHistory: ProjectDeletionPhaseSnapshot[] = [...current.phaseHistory];

    if (status === 'active') {
      nextPhase = phase;
    } else if (status === 'complete') {
      nextPhase = phase;
      // Replace any prior snapshot for this phase (idempotent retries).
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
      projectDeletionSession: {
        ...current,
        phase: nextPhase,
        phaseHistory: nextHistory,
      },
    });
  },

  markProjectDeletionComplete: () => {
    const current = get().projectDeletionSession;
    if (current.kind !== 'deleting') return;
    set({
      projectDeletionSession: {
        kind: 'completed',
        projectId: current.projectId,
        completedAt: Date.now(),
      },
    });
  },

  markProjectDeletionFailed: (shape, correlationId) => {
    const current = get().projectDeletionSession;
    const projectId = current.kind === 'deleting' ? current.projectId : '';
    set({
      projectDeletionSession: {
        kind: 'failed',
        projectId,
        stage: shape.stage,
        message: shape.message,
        ...(shape.hint !== undefined ? { hint: shape.hint } : {}),
        ...(shape.leftovers !== undefined ? { leftovers: shape.leftovers } : {}),
        canForceCleanup: shape.canForceCleanup,
        correlationId,
      },
    });
  },

  resetProjectDeletionSession: () => {
    set({ projectDeletionSession: { kind: 'idle' } });
  },
});

/**
 * Derive the failed phase (if any) from a deleting-session's history.
 * Helper for `<PhasedOperationPanel>` to mark the right step red even
 * while the session is still mid-cascade (force mode continues after a
 * step's `failed` event). Delegates to the generic `selectFailedPhase`.
 */
export function selectProjectDeletionFailedPhase(
  s: { projectDeletionSession: ProjectDeletionSession },
): ProjectDeletionPhase | null {
  return selectFailedPhase(s.projectDeletionSession);
}
