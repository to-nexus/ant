/**
 * selectPreviewVM — the single derivation point for all preview-server UI.
 *
 * Both the Explorer (FeatureSection) and the Preview Config Editor read
 * from this selector via a per-feature key. Any screen that needs a
 * button/spinner/badge/log-view for the preview server must go through
 * here — never directly off `previewByFeature[key].status` — so the two
 * surfaces are guaranteed to agree.
 *
 * Absorbs `analyzePreviewState`, `extractProgress`, and
 * `extractErrorFromLogs` (previously lived under FeatureSection/utils)
 * so their outputs are keyed to the same feature and normalised with
 * the same `isLoading` rule.
 *
 * Invariant: when backend reports `phase === 'running'`, `isLoading` is
 * forced to `false`. A stuck-loading UI cannot exist once the backend
 * considers the server up.
 */

import type { PreviewStatus, LogEntry } from '@/infrastructure/http/api';
import type { PerFeaturePreviewState } from '../slices/previewSlice';
import {
  analyzePreviewState,
  extractErrorFromLogs,
  extractProgress,
} from '@/presentation/components/FeatureSection/utils/preview';
import type {
  PreviewState,
  PreviewError,
  PreviewProgress,
  SetupFailureReasoning,
} from '@/presentation/components/FeatureSection/types/preview';

export interface PreviewVM {
  featureKey: string | null;
  state: PreviewState;
  phase: NonNullable<PreviewStatus['phase']> | 'idle';
  running: boolean;
  ready: boolean;
  /**
   * Normalised loading flag. Always `false` when backend reports
   * `phase === 'running'` regardless of the raw `isLoading` field —
   * prevents the "green panel with a spinner forever" bug.
   */
  isLoading: boolean;
  canStart: boolean;
  url?: string;
  logs: LogEntry[];
  issues: PreviewStatus['issues'];
  packages: PreviewStatus['packages'];
  structureType?: PreviewStatus['structureType'];
  projectProfile?: PreviewStatus['projectProfile'];
  connections?: PreviewStatus['connections'];
  error?: PreviewError;
  setupReasoning?: SetupFailureReasoning;
  setupReason?: string;
  /**
   * Aggregated suggested-fix text. Combines all `issues[].suggestedFix`
   * entries (fatal first) falling back to the top-level `suggestedFix`.
   * This matches the legacy `effectiveSuggestedFix` computation that
   * lived inline in `usePreviewManager`.
   */
  suggestedFix?: string;
  progress?: PreviewProgress;
  /** Original `PreviewStatus` for consumers that still need the raw shape. */
  status: PreviewStatus | undefined;
}

const EMPTY_LOGS: LogEntry[] = Object.freeze([]) as unknown as LogEntry[];

// ── Reference-stability cache ───────────────────────────────────────
// The selector is invoked by `useStore` on every store update. If it
// returned a fresh object each call, zustand's default `Object.is`
// subscriber comparison would mis-detect a change on EVERY unrelated
// slice update (chat SSE, job state, etc.) and force a render of every
// preview consumer. `shallow` doesn't help either because `error` and
// `progress` are computed via fresh object literals.
//
// Instead, we key a WeakMap on the per-feature entry object itself —
// the slice already produces a brand-new entry reference on mutation
// (spread copy in `setPreviewStatus`/`mergePreviewStatus`/etc.), so
// entry identity IS the change signal. While the entry ref is stable
// we return the same VM ref, and React bails out of re-rendering.
const vmCache = new WeakMap<PerFeaturePreviewState, PreviewVM>();

// Stable "empty VM" reference for the key===null / missing-entry case
// so consumers don't rerender on every tick before any feature is
// selected.
let emptyVM: PreviewVM | undefined;

function buildEmptyVM(): PreviewVM {
  if (emptyVM) return emptyVM;
  emptyVM = {
    featureKey: null,
    state: 'idle',
    phase: 'idle',
    running: false,
    ready: false,
    isLoading: false,
    canStart: false,
    url: undefined,
    logs: EMPTY_LOGS,
    issues: undefined,
    packages: undefined,
    structureType: undefined,
    projectProfile: undefined,
    connections: undefined,
    error: undefined,
    setupReasoning: undefined,
    setupReason: undefined,
    suggestedFix: undefined,
    progress: undefined,
    status: undefined,
  };
  return emptyVM;
}

export function selectPreviewVM(
  s: { previewByFeature: Record<string, PerFeaturePreviewState> },
  key: string | null,
): PreviewVM {
  const entry: PerFeaturePreviewState | undefined = key
    ? s.previewByFeature[key]
    : undefined;

  if (!entry) return buildEmptyVM();

  const cached = vmCache.get(entry);
  // featureKey check: the same entry object could (in theory) be
  // re-keyed if a caller mutates the map directly. Slice actions never
  // do this, but staying defensive costs a single string compare.
  if (cached && cached.featureKey === key) return cached;
  const status = entry?.status;
  const rawLoading = entry?.isLoading ?? false;

  // Invariant: running ⇒ not loading (see module header).
  const isLoading = status?.phase === 'running' ? false : rawLoading;

  const state: PreviewState = analyzePreviewState(status as any, isLoading);

  const logs = status?.logs ?? EMPTY_LOGS;
  const progress = logs.length > 0 ? extractProgress(logs as any) : undefined;

  let error: PreviewError | undefined;
  if (state === 'error') {
    if (status?.error) {
      error = { message: status.error };
    } else {
      const msg = extractErrorFromLogs(logs as any);
      if (msg) error = { message: msg };
    }
  }

  // Fix-all payload: fatal first, then warnings. Mirrors the previous
  // ad-hoc logic that lived inside usePreviewManager.
  const suggestedFix: string | undefined = (() => {
    const issues = status?.issues ?? [];
    const withFix = issues.filter(
      (i) => !!i.suggestedFix && i.suggestedFix.trim().length > 0,
    );
    if (withFix.length === 0) return status?.suggestedFix;
    const ordered = [...withFix].sort((a, b) => {
      if (a.severity === b.severity) return 0;
      return a.severity === 'fatal' ? -1 : 1;
    });
    return ordered.map((i) => (i.suggestedFix as string).trim()).join('\n\n---\n\n');
  })();

  const vm: PreviewVM = {
    featureKey: key ?? null,
    state,
    phase: (status?.phase ?? 'idle') as NonNullable<PreviewStatus['phase']> | 'idle',
    running: status?.running ?? false,
    ready: status?.ready ?? false,
    isLoading,
    canStart: status?.canStart ?? false,
    url: status?.url ?? undefined,
    logs,
    issues: status?.issues,
    packages: status?.packages,
    structureType: status?.structureType,
    projectProfile: status?.projectProfile,
    connections: status?.connections,
    error,
    setupReasoning: status?.setupReasoning as SetupFailureReasoning | undefined,
    setupReason: status?.setupReason,
    suggestedFix,
    progress,
    status,
  };

  vmCache.set(entry, vm);
  return vm;
}
