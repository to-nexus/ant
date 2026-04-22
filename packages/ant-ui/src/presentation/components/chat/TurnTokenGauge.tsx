import { useMemo } from 'react';
import { useStore } from '@/domain/store';
import { CONTEXT_WINDOW_MAX_TOKENS } from '@ant/shared';

/**
 * Context-fullness gauge rendered to the left of the Send/Stop button.
 *
 * Value semantics — "current context fullness of the latest LLM call":
 *   - Sourced from `kanban.currentPhaseTokenUsage` (single-call snapshot
 *     overwritten by `accumulateTokenUsage()` on every stream `done` event).
 *   - Numerator: inputTokens + outputTokens of that one snapshot.
 *   - Denominator: {@link CONTEXT_WINDOW_MAX_TOKENS} (Anthropic 200K window).
 *   - Idle (no active job): the kanban reducer preserves the last known
 *     snapshot, so the gauge continues to show the last turn's final call.
 */
export function TurnTokenGauge() {
  const phase = useStore((state) => state.kanban?.currentPhaseTokenUsage);

  const view = useMemo(() => {
    if (!phase?.tokenUsage) return null;
    const input = phase.tokenUsage.inputTokens ?? 0;
    const output = phase.tokenUsage.outputTokens ?? 0;
    const total = input + output;
    if (total <= 0) return null;

    const ratio = Math.max(0, Math.min(1, total / CONTEXT_WINDOW_MAX_TOKENS));
    const percent = ratio * 100;

    // Tiered color scheme: blue → amber (≥80%) → red (≥95%).
    // Stays within Tailwind base palette for parity with existing toolbar chrome.
    const zone: 'ok' | 'warn' | 'danger' =
      percent >= 95 ? 'danger' : percent >= 80 ? 'warn' : 'ok';

    const barColor =
      zone === 'danger'
        ? 'bg-red-500'
        : zone === 'warn'
        ? 'bg-amber-500'
        : 'bg-blue-500';

    const trackColor =
      zone === 'danger'
        ? 'bg-red-100 dark:bg-red-900/30'
        : zone === 'warn'
        ? 'bg-amber-100 dark:bg-amber-900/30'
        : 'bg-gray-200 dark:bg-gray-700';

    const textColor =
      zone === 'danger'
        ? 'text-red-700 dark:text-red-300'
        : zone === 'warn'
        ? 'text-amber-700 dark:text-amber-300'
        : 'text-gray-600 dark:text-gray-300';

    return { input, output, total, percent, barColor, trackColor, textColor };
  }, [phase]);

  if (!view) return null;

  const fmt = (n: number) => n.toLocaleString();
  const phaseLabel = phase?.label || phase?.phase || 'node';
  const tooltip =
    `Context · ${fmt(view.total)} / ${fmt(CONTEXT_WINDOW_MAX_TOKENS)}\n` +
    `Input: ${fmt(view.input)}\n` +
    `Output: ${fmt(view.output)}\n` +
    `Node: ${phaseLabel}`;

  return (
    <div
      className="flex items-center gap-1.5 px-1.5 py-0.5"
      title={tooltip}
      aria-label={tooltip}
    >
      <div
        className={`relative w-24 h-1.5 rounded-full overflow-hidden ${view.trackColor}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(view.percent)}
      >
        <div
          className={`h-full ${view.barColor} transition-all duration-300 ease-out`}
          style={{ width: `${Math.min(100, view.percent)}%` }}
        />
      </div>
      <span className={`text-[10px] tabular-nums ${view.textColor}`}>
        {view.percent < 1 ? '<1' : Math.round(view.percent)}%
      </span>
    </div>
  );
}
