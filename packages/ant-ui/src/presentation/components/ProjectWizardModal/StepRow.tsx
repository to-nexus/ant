import { Check, X } from 'lucide-react';
import { cn } from '@/shared/utils/design-system';
import type { ExecStepStatus } from './types';

/**
 * StepRow — execution-progress row with Aurora identity (spec §5.6, §4.5 cookbook).
 *
 * Visual identity:
 *  - done   → emerald→teal gradient pill with ✓
 *  - active → violet→pink dual-border ring spinning over an Aurora pulse halo
 *             (replaces the previous emerald Spinner so the "in-progress"
 *              color encodes the current step, distinct from completion)
 *  - error  → solid red dot with ✕
 *  - pending → dashed neutral ring
 */
export function StepRow({ label, status, error }: { label: string; status: ExecStepStatus; error?: string }) {
  return (
    <div className={cn(
      'flex items-center gap-3 transition-all duration-300',
      status === 'pending' && 'opacity-40',
      status === 'done' && 'opacity-80',
    )}>
      <div
        className="shrink-0 flex items-center justify-center relative"
        style={{ width: 22, height: 22 }}
      >
        {status === 'done' ? (
          <div
            className="flex items-center justify-center"
            style={{
              width: 20,
              height: 20,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, oklch(65% 0.16 155), oklch(60% 0.18 175))',
              boxShadow: '0 2px 6px -1px oklch(60% 0.16 165 / 0.35)',
            }}
          >
            <Check style={{ width: 12, height: 12, color: 'white' }} strokeWidth={3} />
          </div>
        ) : status === 'active' ? (
          <>
            {/* Aurora pulse halo */}
            <span
              aria-hidden
              style={{
                position: 'absolute',
                inset: -2,
                borderRadius: '50%',
                background: 'var(--gradient-aurora)',
                opacity: 0.35,
                filter: 'blur(6px)',
                animation: 'pulse-soft 1.6s ease-in-out infinite',
                pointerEvents: 'none',
              }}
            />
            {/* Violet→pink dual-border spinner */}
            <span
              aria-hidden
              style={{
                position: 'relative',
                width: 20,
                height: 20,
                borderRadius: '50%',
                border: '2.5px solid transparent',
                borderTopColor: 'oklch(64% 0.20 290)',
                borderRightColor: 'oklch(66% 0.22 350)',
                animation: 'spin 0.9s linear infinite',
              }}
            />
          </>
        ) : status === 'error' ? (
          <div
            className="flex items-center justify-center"
            style={{
              width: 20,
              height: 20,
              borderRadius: '50%',
              background: 'var(--status-error-fg)',
            }}
          >
            <X style={{ width: 12, height: 12, color: 'white' }} strokeWidth={3} />
          </div>
        ) : (
          <div
            style={{
              width: 20,
              height: 20,
              borderRadius: '50%',
              border: '2px dashed var(--border-3)',
            }}
          />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <span
          className="text-sm transition-colors duration-300"
          style={{
            color:
              status === 'active' ? 'var(--violet-700)' :
              status === 'done' ? 'var(--text-3)' :
              status === 'error' ? 'var(--status-error-fg)' :
              'var(--text-4)',
            fontWeight: status === 'active' || status === 'error' ? 600 : 400,
          }}
        >
          {label}
        </span>
        {error && (
          <div
            className="text-xs mt-0.5"
            style={{ color: 'var(--status-error-fg)' }}
          >
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
