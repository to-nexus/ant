/**
 * LifecycleSegment — the header's draft ⇄ published control. Same pill
 * grammar as BoardViewModeToggle (selectedSegmentStyle + gradient underline)
 * so it reads as "which state is this in", and clicking the OTHER segment is
 * the enable/disable action itself: the lifecycle has one home.
 */

import { PencilRuler, Rocket } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { selectedSegmentStyle } from '../aurora/selection';
import type { LifecycleDecision, LifecycleStage } from './lifecycle';

export function LifecycleSegment({
  decision,
  busy,
  activationCount,
  onChange,
}: {
  decision: LifecycleDecision;
  busy: boolean;
  activationCount: number;
  onChange: (next: LifecycleStage) => void;
}) {
  const { t } = useTranslation('pipelines');
  const reason =
    decision.block === 'dirty'
      ? t('availability.saveFirst', 'Save your changes before publishing.')
      : decision.block === 'activations'
        ? t('availability.activationsFirst', 'Deactivate the {{n}} activation(s) first.', { n: activationCount })
        : undefined;
  const options: Array<{ id: LifecycleStage; label: string; icon: typeof Rocket }> = [
    { id: 'draft', label: t('availability.toDraft', 'Draft'), icon: PencilRuler },
    { id: 'published', label: t('availability.publish', 'Published'), icon: Rocket },
  ];
  return (
    <div
      role="group"
      aria-label={t('availability.segmentLabel', 'Publication state')}
      title={reason}
      style={{ display: 'inline-flex', gap: 3, padding: 3, background: 'var(--bg-surface-2)', border: '1px solid var(--border-2)', borderRadius: 'var(--r-pill)', boxShadow: 'var(--shadow-xs)' }}
    >
      {options.map((opt) => {
        const active = decision.stage === opt.id;
        const blocked = !active && (decision.block !== undefined || busy);
        const Icon = opt.icon;
        return (
          <button
            key={opt.id}
            type="button"
            disabled={blocked}
            aria-pressed={active}
            aria-label={opt.label}
            title={!active ? reason : undefined}
            onClick={() => !active && onChange(opt.id)}
            style={{
              position: 'relative',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 12px',
              borderRadius: 999,
              ...selectedSegmentStyle(active),
              fontFamily: 'inherit',
              fontSize: 12,
              fontWeight: 700,
              cursor: blocked ? 'not-allowed' : active ? 'default' : 'pointer',
              opacity: blocked ? 0.55 : 1,
              boxShadow: active ? 'var(--shadow-xs)' : 'none',
              transition: 'all var(--dur-base) var(--ease-spring)',
            }}
          >
            <Icon size={13} aria-hidden="true" />
            <span>{opt.label}</span>
            {active && (
              <span aria-hidden="true" className="gradient-flow" style={{ position: 'absolute', bottom: -3, left: 12, right: 12, height: 2, background: 'var(--gradient-aurora)', backgroundSize: '200% 200%', borderRadius: 2 }} />
            )}
          </button>
        );
      })}
    </div>
  );
}
