import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../Modal';
import { StepIndicator } from './primitives/StepIndicator';
import { buildStepStatusArray } from './buildStepStatusArray';
import type { PhasedOperationSession } from './PhasedOperationSession';

/**
 * Generic phased-operation progress panel. Renders one of three modes
 * driven by `session.kind`:
 *
 *   - `deleting`  — step rail + elapsed counter; not dismissable.
 *   - `completed` — brief success indicator, auto-dismisses after
 *                   `autoDismissMs` (default 600ms).
 *   - `failed`    — stage banner, hint, expandable leftovers, correlationId,
 *                   and a Force CTA when `canForceCleanup === true`.
 *
 * Used by `<ProjectDeletionPanel>` and `<FeatureDeletionPanel>` (and any
 * future phased flow). All copy is i18n-keyed under `${i18nNamespace}` ×
 * `${i18nPrefix}.*` so adding a new domain only requires sibling i18n keys
 * + a thin wrapper component.
 *
 * Required i18n key layout (relative to `${i18nPrefix}`):
 *   .title
 *   .body                  (uses `bodyVars` interpolation)
 *   .completed.title
 *   .completed.body        (uses `bodyVars` interpolation)
 *   .failed.title
 *   .failed.stage          (vars: { current, total, label })
 *   .failed.leftoversShow  (vars: { count })
 *   .failed.correlationId  (vars: { cid })
 *   .failed.dismiss
 *   .failed.forceDelete
 *   .step.<phase>          (one per TPhase value)
 */
export interface PhasedOperationPanelProps<TPhase extends string> {
  session: PhasedOperationSession<TPhase>;
  phaseOrder: readonly TPhase[];
  /**
   * Failed phase derived from the session's history while still in
   * `deleting`; selectors live in the domain slice (e.g.
   * `selectProjectDeletionFailedPhase`). For `failed` sessions, the
   * panel uses `session.stage` directly.
   */
  failedPhaseDuringCascade: TPhase | null;
  /** i18n namespace (typically `'async'`). */
  i18nNamespace: string;
  /** Key prefix under the namespace (e.g. `'projectDeletion'`). */
  i18nPrefix: string;
  /**
   * Variables interpolated into `<prefix>.body` and `<prefix>.completed.body`
   * (e.g. `{ projectId }`, `{ projectId, featureName }`).
   */
  bodyVars: Record<string, string | number>;
  onForceCleanup: () => void;
  onDismiss: () => void;
  autoDismissMs?: number;
}

export function PhasedOperationPanel<TPhase extends string>({
  session,
  phaseOrder,
  failedPhaseDuringCascade,
  i18nNamespace,
  i18nPrefix,
  bodyVars,
  onForceCleanup,
  onDismiss,
  autoDismissMs = 600,
}: PhasedOperationPanelProps<TPhase>) {
  const { t } = useTranslation(i18nNamespace);

  useEffect(() => {
    if (session.kind !== 'completed') return;
    const id = window.setTimeout(() => onDismiss(), autoDismissMs);
    return () => window.clearTimeout(id);
  }, [session.kind, onDismiss, autoDismissMs]);

  const elapsedSeconds = useElapsedSeconds(
    session.kind === 'deleting' ? session.startedAt : null,
  );

  const [leftoversOpen, setLeftoversOpen] = useState(false);

  if (session.kind === 'idle') return null;

  const isDismissable = session.kind === 'failed';

  const title =
    session.kind === 'failed'
      ? t(`${i18nPrefix}.failed.title`)
      : session.kind === 'completed'
      ? t(`${i18nPrefix}.completed.title`)
      : t(`${i18nPrefix}.title`);

  return (
    <Modal
      isOpen
      onClose={() => {
        if (isDismissable) onDismiss();
      }}
      title={title}
      size="md"
    >
      {session.kind === 'deleting' && (
        <DeletingView<TPhase>
          phaseOrder={phaseOrder}
          currentPhase={session.phase}
          failedPhase={failedPhaseDuringCascade}
          elapsedSeconds={elapsedSeconds}
          bodyText={t(`${i18nPrefix}.body`, bodyVars)}
          stageLabel={(phase) => t(`${i18nPrefix}.step.${phase}`)}
          elapsedLabel={(seconds) => t('ide.elapsed', { seconds })}
        />
      )}

      {session.kind === 'completed' && (
        <CompletedView bodyText={t(`${i18nPrefix}.completed.body`, bodyVars)} />
      )}

      {session.kind === 'failed' && (
        <FailedView<TPhase>
          phaseOrder={phaseOrder}
          stage={session.stage}
          message={session.message}
          hint={session.hint}
          leftovers={session.leftovers}
          canForceCleanup={session.canForceCleanup}
          correlationId={session.correlationId}
          leftoversOpen={leftoversOpen}
          setLeftoversOpen={setLeftoversOpen}
          onForceCleanup={onForceCleanup}
          onClose={onDismiss}
          stageLabel={(phase) => t(`${i18nPrefix}.step.${phase}`)}
          stageBanner={(current, total, label) =>
            t(`${i18nPrefix}.failed.stage`, { current, total, label })
          }
          leftoversShow={(count) => t(`${i18nPrefix}.failed.leftoversShow`, { count })}
          correlationIdLabel={(cid) => t(`${i18nPrefix}.failed.correlationId`, { cid })}
          dismissCta={t(`${i18nPrefix}.failed.dismiss`)}
          forceCleanupCta={t(`${i18nPrefix}.failed.forceDelete`)}
        />
      )}
    </Modal>
  );
}

interface DeletingViewProps<TPhase extends string> {
  phaseOrder: readonly TPhase[];
  currentPhase: TPhase | null;
  failedPhase: TPhase | null;
  elapsedSeconds: number | undefined;
  bodyText: string;
  stageLabel: (phase: TPhase) => string;
  elapsedLabel: (seconds: number) => string;
}

function DeletingView<TPhase extends string>({
  phaseOrder,
  currentPhase,
  failedPhase,
  elapsedSeconds,
  bodyText,
  stageLabel,
  elapsedLabel,
}: DeletingViewProps<TPhase>) {
  const labels = phaseOrder.reduce(
    (acc, id) => ({ ...acc, [id]: stageLabel(id) }),
    {} as Record<TPhase, string>,
  );

  const steps = buildStepStatusArray<TPhase>({
    order: phaseOrder,
    currentPhase,
    failedPhase,
    labels,
    trailingFor: (_phase, status) =>
      status === 'active' && elapsedSeconds !== undefined && elapsedSeconds > 0
        ? elapsedLabel(elapsedSeconds)
        : undefined,
  });

  return (
    <div>
      <p className="text-sm text-[color:var(--text-3)] mb-4">{bodyText}</p>
      <StepIndicator steps={steps} orientation="vertical" />
    </div>
  );
}

function CompletedView({ bodyText }: { bodyText: string }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <span
        className="flex h-6 w-6 items-center justify-center rounded-full text-sm font-semibold"
        style={{ background: 'var(--status-done-bg)', color: 'var(--status-done-fg)' }}
      >
        ✓
      </span>
      <span className="text-sm text-[color:var(--text-2)]">{bodyText}</span>
    </div>
  );
}

interface FailedViewProps<TPhase extends string> {
  phaseOrder: readonly TPhase[];
  stage: TPhase;
  message: string;
  hint?: string;
  leftovers?: string[];
  canForceCleanup: boolean;
  correlationId: string;
  leftoversOpen: boolean;
  setLeftoversOpen: (open: boolean) => void;
  onForceCleanup: () => void;
  onClose: () => void;
  stageLabel: (phase: TPhase) => string;
  stageBanner: (current: number, total: number, label: string) => string;
  leftoversShow: (count: number) => string;
  correlationIdLabel: (cid: string) => string;
  dismissCta: string;
  forceCleanupCta: string;
}

function FailedView<TPhase extends string>({
  phaseOrder,
  stage,
  message,
  hint,
  leftovers,
  canForceCleanup,
  correlationId,
  leftoversOpen,
  setLeftoversOpen,
  onForceCleanup,
  onClose,
  stageLabel,
  stageBanner,
  leftoversShow,
  correlationIdLabel,
  dismissCta,
  forceCleanupCta,
}: FailedViewProps<TPhase>) {
  const stageNumber = useMemo(() => phaseOrder.indexOf(stage) + 1, [phaseOrder, stage]);
  const totalSteps = phaseOrder.length;
  const stageLabelText = stageLabel(stage);

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-rose-200 bg-rose-50 p-3">
        <p className="text-sm font-medium text-rose-700">
          {stageBanner(Math.max(stageNumber, 1), totalSteps, stageLabelText)}
        </p>
        <p className="text-sm text-rose-600 mt-1 whitespace-pre-wrap break-words">
          {message}
        </p>
        {hint && <p className="text-xs text-rose-600/80 mt-2">{hint}</p>}
      </div>

      {leftovers && leftovers.length > 0 && (
        <details
          open={leftoversOpen}
          onToggle={(e) => setLeftoversOpen((e.target as HTMLDetailsElement).open)}
          className="rounded-md border border-[color:var(--border-1)] bg-[color:var(--bg-canvas)]/40 px-3 py-2"
        >
          <summary className="cursor-pointer text-xs text-[color:var(--text-3)]">
            {leftoversShow(leftovers.length)}
          </summary>
          <ul className="mt-2 text-xs font-mono text-[color:var(--text-2)] space-y-1 max-h-40 overflow-auto">
            {leftovers.map((p) => (
              <li key={p} className="truncate">{p}</li>
            ))}
          </ul>
        </details>
      )}

      {correlationId && (
        <p className="text-[11px] text-[color:var(--text-4)] tabular-nums">
          {correlationIdLabel(correlationId)}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 text-sm rounded-md border border-[color:var(--border-2)] text-[color:var(--text-2)] hover:bg-[color:var(--bg-hover)] transition-colors"
        >
          {dismissCta}
        </button>
        {canForceCleanup && (
          <button
            type="button"
            onClick={onForceCleanup}
            className="px-3 py-1.5 text-sm rounded-md bg-rose-600 text-white hover:bg-rose-700 transition-colors font-medium"
          >
            {forceCleanupCta}
          </button>
        )}
      </div>
    </div>
  );
}

function useElapsedSeconds(startedAt: number | null): number | undefined {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);
  if (startedAt === null) return undefined;
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}
