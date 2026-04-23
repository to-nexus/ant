import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CONTEXT_WINDOW_MAX_TOKENS, type PhaseTokenUsage } from '@ant/shared';
import { Tooltip } from '@/presentation/components/common/Tooltip';

export interface TokenRingProps {
  /** Phase snapshot rendered as a single ring. */
  phase: PhaseTokenUsage;
  /**
   * When set, the Tooltip is rendered without its own trigger and the ring
   * is drawn inline. Used by `TurnTokenGauge`'s more-dropdown where the outer
   * list row handles click-to-open semantics for the nested tooltip.
   */
  variant?: 'standalone' | 'in-list';
}

// ── Ring geometry ─────────────────────────────────────────────────────────
// Donut shape: empty track + clockwise fill starting at 12 o'clock.
// A ring avoids the "full = good" cue a battery icon carries; here a full
// ring means the context window is nearly saturated (i.e. bad).
const SIZE = 14;           // overall pixel box
const STROKE_WIDTH = 3;    // ring thickness (reads as a donut, not a circle)
const RADIUS = (SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Compact context-fullness ring for a single graph node / worker. Two arcs
 * (input + output) together form the filled portion, drawn clockwise from
 * 12 o'clock over an empty track. Click opens a tooltip with precise numbers.
 */
export function TokenRing({ phase, variant = 'standalone' }: TokenRingProps) {
  const { t } = useTranslation('common');
  const view = useMemo(() => buildView(phase, t), [phase, t]);
  if (!view) return null;

  const inputLen = (view.inputPct / 100) * CIRCUMFERENCE;
  const outputLen = (view.outputPct / 100) * CIRCUMFERENCE;

  const ring = (
    <div
      className="flex items-center"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(view.totalPct)}
      aria-label={view.ariaLabel}
    >
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        {/* Empty track */}
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE_WIDTH}
          className="stroke-gray-300 dark:stroke-gray-600"
        />
        {/* Progress arcs — rotate -90deg so drawing starts at 12 o'clock */}
        <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
          {inputLen > 0 && (
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              strokeWidth={STROKE_WIDTH}
              strokeLinecap="butt"
              strokeDasharray={`${inputLen} ${CIRCUMFERENCE - inputLen}`}
              className={`${view.inputStroke} ${view.estimating ? 'opacity-60' : ''} transition-[stroke-dasharray] duration-300 ease-out`}
            />
          )}
          {outputLen > 0 && (
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              strokeWidth={STROKE_WIDTH}
              strokeLinecap="butt"
              strokeDasharray={`${outputLen} ${CIRCUMFERENCE - outputLen}`}
              strokeDashoffset={-inputLen}
              className={`${view.outputStroke} transition-[stroke-dasharray] duration-300 ease-out`}
            />
          )}
        </g>
      </svg>
    </div>
  );

  if (variant === 'in-list') {
    return (
      <Tooltip content={view.tooltip} placement="left" trigger="hover">
        {ring}
      </Tooltip>
    );
  }

  return (
    <Tooltip content={view.tooltip} placement="top" trigger="hover">
      {ring}
    </Tooltip>
  );
}

/**
 * Headline string used by the more-dropdown row title — compact
 * "Worker N · Task · 17%".
 *
 * `t` is the `react-i18next` `t` fn bound to the `common` namespace so the
 * "Main" / "Worker N" labels follow the active locale.
 */
export function summarizeRing(
  phase: PhaseTokenUsage,
  t: (key: string, opts?: Record<string, unknown>) => string,
): { title: string; percent: string } {
  const input = phase.tokenUsage?.inputTokens ?? 0;
  const output = phase.tokenUsage?.outputTokens ?? 0;
  const total = input + output;
  const pct = total <= 0 ? 0 : (total / CONTEXT_WINDOW_MAX_TOKENS) * 100;
  const pctText = pct < 1 ? '<1%' : `${Math.round(pct)}%`;

  const parts: string[] = [];
  if (typeof phase.workerId === 'number') {
    parts.push(t('turnTokenGauge.worker', { n: phase.workerId }));
  } else {
    parts.push(t('turnTokenGauge.main'));
  }
  if (phase.taskName) parts.push(phase.taskName);
  else if (phase.label) parts.push(phase.label);
  return { title: parts.join(' · '), percent: pctText };
}

function buildView(
  phase: PhaseTokenUsage,
  t: (key: string, opts?: Record<string, unknown>) => string,
) {
  if (!phase?.tokenUsage) return null;
  const input = phase.tokenUsage.inputTokens ?? 0;
  const output = phase.tokenUsage.outputTokens ?? 0;
  const total = input + output;
  // Cursor-style: render the ring even at 0 tokens. The empty donut track
  // is the visual placeholder for "node active, no usage yet" — it does
  // not disappear between LLM calls or before the first `usage_partial`.
  const estimating = phase.estimating === true;

  const max = CONTEXT_WINDOW_MAX_TOKENS;
  const totalPct = clampPct((total / max) * 100);
  const inputPct = clampPct((input / max) * 100);
  const outputPct = clampPct((output / max) * 100);

  const zone: 'ok' | 'warn' | 'danger' =
    totalPct >= 95 ? 'danger' : totalPct >= 80 ? 'warn' : 'ok';

  // OK zone: theme-adaptive neutral (white on dark, slate on light). Input is
  // solid, output is a lighter variant so the two segments remain visually
  // distinguishable within a single ring. Warn/danger zones keep amber/red
  // to preserve the "context filling up" warning signal across themes.
  const inputStroke =
    zone === 'danger'
      ? 'stroke-red-500'
      : zone === 'warn'
      ? 'stroke-amber-500'
      : 'stroke-slate-700 dark:stroke-white';

  const outputStroke =
    zone === 'danger'
      ? 'stroke-red-300'
      : zone === 'warn'
      ? 'stroke-amber-300'
      : 'stroke-slate-400 dark:stroke-white/50';

  const fmt = (n: number) => n.toLocaleString();
  const fmtPct = (p: number) => (p < 1 ? '<1%' : `${Math.round(p)}%`);

  const headerTitle = headerTitleFor(phase, t);

  const tooltip = (
    <div className="flex flex-col gap-1 text-xs min-w-[180px]">
      {headerTitle && (
        <div className="text-[11px] text-gray-500 dark:text-gray-400 max-w-[220px] break-words">
          {headerTitle}
        </div>
      )}
      <div className="flex items-center justify-between gap-3 font-semibold">
        <span>{t('turnTokenGauge.context')}</span>
        <span className="tabular-nums">{fmtPct(totalPct)}</span>
      </div>
      <div className="text-[11px] tabular-nums text-gray-600 dark:text-gray-300">
        {fmt(total)} / {fmt(max)}
      </div>
      <div className="h-px my-0.5 bg-gray-200 dark:bg-gray-700" />
      <div className="flex items-center justify-between gap-3 tabular-nums">
        <span>{t('turnTokenGauge.input')}</span>
        <span>{fmt(input)}</span>
      </div>
      <div className="flex items-center justify-between gap-3 tabular-nums">
        <span>{t('turnTokenGauge.output')}</span>
        <span>{fmt(output)}</span>
      </div>
      {estimating && (
        <div className="mt-1 text-[10px] leading-snug text-gray-500 dark:text-gray-400 italic">
          {t('turnTokenGauge.estimatingNote')}
        </div>
      )}
    </div>
  );

  const ariaLabel = headerTitle
    ? t('turnTokenGauge.ariaLabelWithTitle', {
        title: headerTitle,
        totalPct: fmtPct(totalPct),
        input: fmt(input),
        output: fmt(output),
        max: fmt(max),
      })
    : t('turnTokenGauge.ariaLabel', {
        totalPct: fmtPct(totalPct),
        input: fmt(input),
        output: fmt(output),
        max: fmt(max),
      });

  return {
    totalPct,
    inputPct,
    outputPct,
    inputStroke,
    outputStroke,
    tooltip,
    ariaLabel,
    estimating,
  };
}


function headerTitleFor(
  phase: PhaseTokenUsage,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const parts: string[] = [];
  if (typeof phase.workerId === 'number') {
    parts.push(t('turnTokenGauge.worker', { n: phase.workerId }));
  }
  if (phase.taskName) parts.push(phase.taskName);
  else if (phase.label) parts.push(phase.label);
  return parts.join(' · ');
}

function clampPct(p: number) {
  return Math.max(0, Math.min(100, p));
}
