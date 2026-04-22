import { useMemo } from 'react';
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
  const view = useMemo(() => buildView(phase), [phase]);
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
              className={`${view.inputStroke} transition-[stroke-dasharray] duration-300 ease-out`}
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
      <Tooltip content={view.tooltip} placement="left">
        {ring}
      </Tooltip>
    );
  }

  return (
    <Tooltip content={view.tooltip} placement="top">
      {ring}
    </Tooltip>
  );
}

/**
 * Headline string used by the more-dropdown row title — compact
 * "Worker N · Task · 17%".
 */
export function summarizeRing(phase: PhaseTokenUsage): { title: string; percent: string } {
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
          <span className={`inline-block w-2 h-2 rounded-sm ${swatchFor(inputStroke)}`} />
          Input
        </span>
        <span>{fmt(input)}</span>
      </div>
      <div className="flex items-center justify-between gap-3 tabular-nums">
        <span className="flex items-center gap-1.5">
          <span className={`inline-block w-2 h-2 rounded-sm ${swatchFor(outputStroke)}`} />
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
    inputStroke,
    outputStroke,
    tooltip,
    ariaLabel,
  };
}

/**
 * Tooltip legend swatches share the ring's zone color. Map stroke-* class
 * to a matching bg-* class so the legend squares stay in sync. Handles
 * compound classes like "stroke-slate-700 dark:stroke-white" by replacing
 * every stroke- prefix (including variant-scoped ones).
 */
function swatchFor(strokeClass: string): string {
  return strokeClass.replace(/(^|\s|:)stroke-/g, '$1bg-');
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
