import { useMemo } from 'react';
import { CONTEXT_WINDOW_MAX_TOKENS, type PhaseTokenUsage } from '@ant/shared';
import { Tooltip } from '@/presentation/components/common/Tooltip';

export interface BatteryGaugeProps {
  /** Phase snapshot rendered as a single battery. */
  phase: PhaseTokenUsage;
  /**
   * When set, the Tooltip is rendered without its own trigger and the battery
   * is drawn inline. Used by `TurnTokenGauge`'s more-dropdown where the outer
   * list row handles click-to-open semantics for the nested tooltip.
   */
  variant?: 'standalone' | 'in-list';
}

/**
 * Phone-battery pictogram representing "context fullness of the latest LLM
 * call" for a single graph node / worker. Two stacked segments inside the body
 * show the input / output split at a glance; click opens a tooltip with the
 * precise numbers.
 */
export function BatteryGauge({ phase, variant = 'standalone' }: BatteryGaugeProps) {
  const view = useMemo(() => buildView(phase), [phase]);
  if (!view) return null;

  const battery = (
    <div
      className="flex items-center"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(view.totalPct)}
      aria-label={view.ariaLabel}
    >
      <div
        className={`relative w-[26px] h-[12px] rounded-[2px] border ${view.chrome} overflow-hidden flex`}
      >
        <div
          className={`${view.inputFill} transition-all duration-300 ease-out`}
          style={{ width: `${view.inputPct}%` }}
        />
        <div
          className={`${view.outputFill} transition-all duration-300 ease-out`}
          style={{ width: `${view.outputPct}%` }}
        />
      </div>
      <div className={`w-[2px] h-[6px] rounded-r-[1px] ${view.cap}`} />
    </div>
  );

  if (variant === 'in-list') {
    // List rows handle their own click target (the row itself), so the
    // battery is rendered inline. A nested Tooltip on top still works
    // because Tooltip renders via portal at z-9999.
    return (
      <Tooltip content={view.tooltip} placement="left">
        {battery}
      </Tooltip>
    );
  }

  return (
    <Tooltip content={view.tooltip} placement="top">
      {battery}
    </Tooltip>
  );
}

/**
 * Headline string used by the more-dropdown row title — compact "Worker N · Task · 17%".
 */
export function summarizeBattery(phase: PhaseTokenUsage): { title: string; percent: string } {
  const input = phase.tokenUsage?.inputTokens ?? 0;
  const output = phase.tokenUsage?.outputTokens ?? 0;
  const total = input + output;
  const pct = total <= 0 ? 0 : (total / CONTEXT_WINDOW_MAX_TOKENS) * 100;
  const pctText = pct < 1 ? '<1%' : `${Math.round(pct)}%`;

  const parts: string[] = [];
  if (typeof phase.workerId === 'number') parts.push(`Worker ${phase.workerId}`);
  else parts.push('Main');
  if (phase.taskName) parts.push(phase.taskName);
  else if (phase.label) parts.push(phase.label);
  return { title: parts.join(' · '), percent: pctText };
}

function buildView(phase: PhaseTokenUsage) {
  if (!phase?.tokenUsage) return null;
  const input = phase.tokenUsage.inputTokens ?? 0;
  const output = phase.tokenUsage.outputTokens ?? 0;
  const total = input + output;
  if (total <= 0) return null;

  const max = CONTEXT_WINDOW_MAX_TOKENS;
  const totalPct = clampPct((total / max) * 100);
  const inputPct = clampPct((input / max) * 100);
  const outputPct = clampPct((output / max) * 100);

  const zone: 'ok' | 'warn' | 'danger' =
    totalPct >= 95 ? 'danger' : totalPct >= 80 ? 'warn' : 'ok';

  const chrome =
    zone === 'danger'
      ? 'border-red-500/70 dark:border-red-400/70'
      : zone === 'warn'
      ? 'border-amber-500/70 dark:border-amber-400/70'
      : 'border-gray-400/70 dark:border-gray-500/70';

  const inputFill =
    zone === 'danger' ? 'bg-red-500' : zone === 'warn' ? 'bg-amber-500' : 'bg-blue-500';

  const outputFill =
    zone === 'danger' ? 'bg-red-300' : zone === 'warn' ? 'bg-amber-300' : 'bg-emerald-400';

  const cap =
    zone === 'danger'
      ? 'bg-red-500/70 dark:bg-red-400/70'
      : zone === 'warn'
      ? 'bg-amber-500/70 dark:bg-amber-400/70'
      : 'bg-gray-400/70 dark:bg-gray-500/70';

  const fmt = (n: number) => n.toLocaleString();
  const fmtPct = (p: number) => (p < 1 ? '<1%' : `${Math.round(p)}%`);

  const headerTitle = headerTitleFor(phase);

  const tooltip = (
    <div className="flex flex-col gap-1 text-xs min-w-[180px]">
      {headerTitle && (
        <div className="text-[11px] text-gray-500 dark:text-gray-400">{headerTitle}</div>
      )}
      <div className="flex items-center justify-between gap-3 font-semibold">
        <span>Context</span>
        <span className="tabular-nums">{fmtPct(totalPct)}</span>
      </div>
      <div className="text-[11px] tabular-nums text-gray-600 dark:text-gray-300">
        {fmt(total)} / {fmt(max)}
      </div>
      <div className="h-px my-0.5 bg-gray-200 dark:bg-gray-700" />
      <div className="flex items-center justify-between gap-3 tabular-nums">
        <span className="flex items-center gap-1.5">
          <span className={`inline-block w-2 h-2 rounded-sm ${inputFill}`} />
          Input
        </span>
        <span>{fmt(input)}</span>
      </div>
      <div className="flex items-center justify-between gap-3 tabular-nums">
        <span className="flex items-center gap-1.5">
          <span className={`inline-block w-2 h-2 rounded-sm ${outputFill}`} />
          Output
        </span>
        <span>{fmt(output)}</span>
      </div>
    </div>
  );

  const ariaLabel =
    `${headerTitle ? headerTitle + ', ' : ''}` +
    `context ${fmtPct(totalPct)}, input ${fmt(input)}, output ${fmt(output)}, max ${fmt(max)}`;

  return {
    totalPct,
    inputPct,
    outputPct,
    chrome,
    inputFill,
    outputFill,
    cap,
    tooltip,
    ariaLabel,
  };
}

function headerTitleFor(phase: PhaseTokenUsage): string {
  const parts: string[] = [];
  if (typeof phase.workerId === 'number') parts.push(`Worker ${phase.workerId}`);
  if (phase.taskName) parts.push(phase.taskName);
  else if (phase.label) parts.push(phase.label);
  return parts.join(' · ');
}

function clampPct(p: number) {
  return Math.max(0, Math.min(100, p));
}
