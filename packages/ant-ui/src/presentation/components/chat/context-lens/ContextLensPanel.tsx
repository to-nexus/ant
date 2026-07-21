import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pin, X } from 'lucide-react';
import type { ContextLensResponse } from '@ant/shared';
import { useStore } from '@/domain/store';
import {
  AsyncBoundary,
  EmptyFallback,
  useAsyncResource,
} from '@/presentation/components/common/async';

interface ContextLensPanelProps {
  projectId: string;
  featureName: string;
  onClose: () => void;
}

/**
 * Context panel (Context Lens E2-4) — what will carry over to the next job,
 * band by band:
 *
 *   1. Standing Constraints — the verbatim ledger (injection floor: every
 *      profile always renders these) + the band-3 rolling summary that
 *      represents older, folded turns.
 *   2. Recent Exchanges — band-1 verbatim user↔assistant pairs.
 *   3. Prior Turn Digests — band-2 structured decisions/constraints/outcome.
 *
 * Pin = ledger promotion: any exchange text or digest bullet can be pinned,
 * which appends it to the Constraint Ledger via POST context/pin (the BE
 * writes a new append-only checkpoint). Already-pinned texts render as
 * inert "pinned" state — the slice patches the cached ledger from the
 * server response (mutate-with-ground-truth).
 */
export function ContextLensPanel({ projectId, featureName, onClose }: ContextLensPanelProps) {
  const { t } = useTranslation('chat');
  const lens = useAsyncResource<ContextLensResponse>((s) => s.contextLens);
  const loadContextLens = useStore((s) => s.loadContextLens);

  return (
    <div
      role="dialog"
      aria-label={t('contextLens.panelTitle')}
      className="absolute z-50 flex flex-col"
      style={{
        top: 'calc(100% + 8px)',
        right: 0,
        width: 340,
        maxHeight: 440,
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-1)',
        borderRadius: 'var(--r-md)',
        boxShadow: 'var(--shadow-lg)',
      }}
    >
      <div
        className="flex items-center justify-between flex-shrink-0"
        style={{ padding: '10px 12px 8px', borderBottom: '1px solid var(--border-1)' }}
      >
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1)' }}>
          {t('contextLens.panelTitle')}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common:button.close', { defaultValue: 'Close' })}
          className="flex items-center justify-center hover:bg-[color:var(--bg-hover)] transition-colors"
          style={{ width: 20, height: 20, borderRadius: 'var(--r-sm)', color: 'var(--text-3)' }}
        >
          <X size={12} strokeWidth={2.2} />
        </button>
      </div>

      <div className="overflow-y-auto" style={{ padding: '8px 12px 12px' }}>
        <AsyncBoundary
          surface="region"
          resource={lens}
          retry={() => void loadContextLens(projectId, featureName)}
          empty={<EmptyFallback description={t('contextLens.empty')} />}
        >
          {(data) => (
            <PanelBody
              data={data}
              projectId={projectId}
              featureName={featureName}
            />
          )}
        </AsyncBoundary>
      </div>
    </div>
  );
}

function PanelBody({
  data,
  projectId,
  featureName,
}: {
  data: ContextLensResponse;
  projectId: string;
  featureName: string;
}) {
  const { t } = useTranslation('chat');

  return (
    <div className="flex flex-col gap-3">
      {/* ── Band 3: Standing Constraints + rolling summary ─────────────── */}
      <section>
        <SectionTitle label={t('contextLens.constraints')} count={data.ledger.length} />
        {data.ledger.length === 0 ? (
          <p style={{ fontSize: 11, color: 'var(--text-3)', margin: '2px 0 0' }}>
            {t('contextLens.constraintsEmpty')}
          </p>
        ) : (
          <ul className="flex flex-col gap-1 mt-1">
            {data.ledger.map((entry, i) => (
              <li
                key={`${i}-${entry.slice(0, 24)}`}
                className="flex items-start gap-1.5"
                style={{
                  fontSize: 11,
                  lineHeight: '15px',
                  color: 'var(--text-2)',
                  padding: '4px 6px',
                  borderRadius: 'var(--r-sm)',
                  background: 'oklch(from var(--violet-300) l c h / 0.08)',
                  border: '1px solid oklch(from var(--violet-400) l c h / 0.2)',
                }}
              >
                <Pin size={10} strokeWidth={2.2} style={{ marginTop: 2, flexShrink: 0, color: 'var(--violet-600)' }} aria-hidden="true" />
                <span className="min-w-0 break-words">{entry}</span>
              </li>
            ))}
          </ul>
        )}
        {data.summary && (
          <div className="mt-2">
            <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-3)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {t('contextLens.summaryLabel')}
            </p>
            <p
              className="break-words"
              style={{
                fontSize: 11,
                lineHeight: '15px',
                color: 'var(--text-3)',
                margin: '3px 0 0',
                maxHeight: 90,
                overflowY: 'auto',
                whiteSpace: 'pre-wrap',
              }}
            >
              {data.summary}
            </p>
          </div>
        )}
      </section>

      {/* ── Band 1: Recent Exchanges ────────────────────────────────────── */}
      {data.exchanges.length > 0 && (
        <section>
          <SectionTitle label={t('contextLens.exchanges')} count={data.exchanges.length} />
          <ul className="flex flex-col gap-1.5 mt-1">
            {[...data.exchanges].reverse().map((ex) => (
              <li
                key={ex.turnId}
                style={{
                  padding: '5px 6px',
                  borderRadius: 'var(--r-sm)',
                  border: '1px solid var(--border-1)',
                }}
              >
                <div className="flex items-center gap-1.5">
                  {ex.jobType && <JobChip jobType={ex.jobType} />}
                  {ex.ephemeral && (
                    <span style={{ fontSize: 9, color: 'var(--text-3)', border: '1px solid var(--border-1)', borderRadius: 3, padding: '0 3px' }}>
                      {t('contextLens.ephemeral')}
                    </span>
                  )}
                  <span className="flex-1" />
                  <PinButton projectId={projectId} featureName={featureName} text={ex.userText} ledger={data.ledger} />
                </div>
                <p className="break-words" style={{ fontSize: 11, lineHeight: '15px', color: 'var(--text-1)', margin: '3px 0 0' }}>
                  {clamp(ex.userText, 160)}
                </p>
                {ex.assistantFinalText && (
                  <p className="break-words" style={{ fontSize: 11, lineHeight: '15px', color: 'var(--text-3)', margin: '2px 0 0' }}>
                    {clamp(ex.assistantFinalText, 160)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Band 2: Prior Turn Digests ──────────────────────────────────── */}
      {data.digests.length > 0 && (
        <section>
          <SectionTitle label={t('contextLens.digests')} count={data.digests.length} />
          <ul className="flex flex-col gap-1.5 mt-1">
            {[...data.digests].reverse().map((d) => (
              <li
                key={d.turnId}
                style={{
                  padding: '5px 6px',
                  borderRadius: 'var(--r-sm)',
                  border: '1px solid var(--border-1)',
                }}
              >
                <div className="flex items-center gap-1.5">
                  {d.jobType && <JobChip jobType={d.jobType} />}
                  <span className="flex-1 break-words" style={{ fontSize: 11, color: 'var(--text-2)' }}>
                    {clamp(d.digest.outcome, 120)}
                  </span>
                </div>
                {[...d.digest.decisions, ...d.digest.constraints].map((bullet, i) => (
                  <div key={`${d.turnId}-b${i}`} className="flex items-start gap-1.5 mt-1">
                    <span className="flex-1 min-w-0 break-words" style={{ fontSize: 11, lineHeight: '15px', color: 'var(--text-3)' }}>
                      • {clamp(bullet, 140)}
                    </span>
                    <PinButton projectId={projectId} featureName={featureName} text={bullet} ledger={data.ledger} />
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function SectionTitle({ label, count }: { label: string; count?: number }) {
  return (
    <h4
      className="flex items-center gap-1"
      style={{
        fontSize: 10,
        fontWeight: 700,
        color: 'var(--text-3)',
        margin: 0,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
      }}
    >
      {label}
      {typeof count === 'number' && count > 0 && (
        <span className="tabular-nums" style={{ fontWeight: 500 }}>({count})</span>
      )}
    </h4>
  );
}

function JobChip({ jobType }: { jobType: string }) {
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 600,
        color: 'var(--violet-600)',
        background: 'oklch(from var(--violet-300) l c h / 0.12)',
        borderRadius: 3,
        padding: '0 4px',
      }}
    >
      {jobType}
    </span>
  );
}

/**
 * Pin-to-ledger button. Renders as inert "pinned" once the text is in the
 * ledger (the slice patches the ledger from the pin response, so this flips
 * without a refetch). Failures reset to pinnable — the action is retryable.
 */
function PinButton({
  projectId,
  featureName,
  text,
  ledger,
}: {
  projectId: string;
  featureName: string;
  text: string;
  ledger: string[];
}) {
  const { t } = useTranslation('chat');
  const pinContextText = useStore((s) => s.pinContextText);
  const [busy, setBusy] = useState(false);

  const trimmed = text.trim();
  // BE caps pinned text at 500 chars ('…' suffix) — match for pinned-state detection.
  const pinned = ledger.includes(trimmed) || ledger.includes(`${trimmed.slice(0, 500)}…`);
  if (!trimmed) return null;

  if (pinned) {
    return (
      <span
        className="flex items-center flex-shrink-0"
        title={t('contextLens.pinned')}
        aria-label={t('contextLens.pinned')}
        style={{ color: 'var(--violet-600)' }}
      >
        <Pin size={11} strokeWidth={2.4} fill="currentColor" />
      </span>
    );
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        try {
          setBusy(true);
          await pinContextText(projectId, featureName, trimmed);
        } catch (err) {
          console.warn('[ContextLens] pin failed:', err);
        } finally {
          setBusy(false);
        }
      }}
      title={t('contextLens.pin')}
      aria-label={t('contextLens.pin')}
      className="flex items-center flex-shrink-0 hover:text-[color:var(--violet-600)] transition-colors disabled:opacity-40"
      style={{ color: 'var(--text-3)' }}
    >
      <Pin size={11} strokeWidth={2.2} />
    </button>
  );
}

function clamp(text: string, max: number): string {
  const s = text.trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
