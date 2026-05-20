import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import { useStore } from '@/domain/store';
import { type PhaseTokenUsage } from '@ant/shared';
import { Tooltip } from '@/presentation/components/common/Tooltip';
import { TokenRing, summarizeRing } from './TurnTokenRing';

/**
 * Chat-input token gauge — one donut ring per active graph-node / worker.
 *
 * Layout policy:
 *  - 1 ring (sequential / main graph) → renders inline.
 *  - N rings (parallel workers) → renders as many as fit horizontally;
 *    overflow collapses into a "⋯ more" button whose dropdown lists every
 *    ring. Each dropdown row exposes a nested tooltip for its ring.
 *  - Width measurement uses `ResizeObserver` on the wrapping container, so
 *    the visible count adapts to the toolbar's available width (which itself
 *    shrinks with `AgentJobToolbar`'s icon-only breakpoints).
 */
export function TurnTokenGauge() {
  const livePhases = useStore((state) => state.kanban?.currentPhaseTokenUsages);
  const baselinePhase = useStore((state) => state.kanban?.baselinePhaseTokenUsage);
  // Priority: live phases (job running, mid-stream snapshots) > baseline
  // (predicted next-call floor, Phase-2 endpoint). When neither exists, the
  // gauge returns null below. This is the SSOT for "what does the gauge
  // show when there is no active LLM call" — see Phase-3 plan §3.3.
  const visiblePhases = useMemo(() => {
    const live = filterActive(livePhases);
    if (live.length > 0) return live;
    return baselinePhase ? [baselinePhase] : [];
  }, [livePhases, baselinePhase]);

  const hostRef = useRef<HTMLDivElement>(null);
  const [slotWidth, setSlotWidth] = useState<number>(0);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const update = () => setSlotWidth(host.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  if (!visiblePhases.length) return null;

  // Geometry (keep in sync with TurnTokenRing + AgentJobToolbar min-width math):
  //   ring     = 14px square (SVG donut)
  //   gap      = 6px between rings
  //   more btn = 22px
  const RING_W = 14;
  const GAP = 6;
  const MORE_W = 22;

  // Display order: newest first (leftmost) → oldest last (rightmost). The
  // backend publishes `currentPhaseTokenUsages` in creation order (main, then
  // workers as they spawn), so reversing gives the "new entries push from the
  // left" behavior the user expects.
  const ordered = [...visiblePhases].reverse();

  const fit = computeVisibleCount(slotWidth, ordered.length, RING_W, GAP, MORE_W);

  const inline = ordered.slice(0, fit.inlineCount);
  const overflow = ordered.slice(fit.inlineCount);

  // More-button goes on the LEFT so overflow (oldest gauges) is visually
  // aggregated to the left of the newest-on-the-left inline rings.
  // `justify-end` keeps the whole cluster pinned to the right edge of the
  // chat-input toolbar slot.
  return (
    <div
      ref={hostRef}
      className="flex items-center gap-1.5 min-w-0 overflow-hidden flex-1 justify-end"
    >
      {fit.showMore && overflow.length > 0 && <MoreRingsDropdown phases={overflow} />}
      {inline.map((phase, idx) => (
        <TokenRing key={ringKey(phase, idx)} phase={phase} />
      ))}
    </div>
  );
}

interface MoreRingsDropdownProps {
  phases: PhaseTokenUsage[];
}

/**
 * "More" button that opens a vertical list of the remaining rings.
 * Reuses the common <Tooltip/> as the dropdown container so nested tooltips
 * (one per row) work out-of-the-box — each row's ring lives in its own
 * Tooltip rendered on top via portal.
 */
function MoreRingsDropdown({ phases }: MoreRingsDropdownProps) {
  const { t } = useTranslation('common');
  // The row-level Tooltip reads `kanban.currentPhaseTokenUsages`; when a
  // worker terminates mid-interaction, the active tooltip closes naturally
  // because its `phase` prop changes and the global tooltip state resets.
  return (
    <Tooltip
      content={<MoreDropdownList phases={phases} />}
      placement="top"
      className="!p-1.5 !rounded-md !shadow-xl !border !bg-white dark:!bg-slate-900"
    >
      <button
        type="button"
        className="flex items-center justify-center w-[22px] h-[14px] rounded
                   border border-gray-300 dark:border-gray-600
                   text-gray-500 dark:text-gray-300
                   hover:bg-gray-100 dark:hover:bg-gray-700
                   transition-colors"
        aria-label={t('turnTokenGauge.moreAria', { count: phases.length })}
        title={t('turnTokenGauge.moreTitle', { count: phases.length })}
      >
        <MoreHorizontal className="w-3 h-3" />
      </button>
    </Tooltip>
  );
}

function MoreDropdownList({ phases }: { phases: PhaseTokenUsage[] }) {
  const { t } = useTranslation('common');
  return (
    <ul className="flex flex-col gap-0.5 min-w-[180px] max-h-[240px] overflow-y-auto">
      {phases.map((phase, idx) => {
        const summary = summarizeRing(phase, t);
        return (
          <li
            key={ringKey(phase, idx)}
            className="flex items-center justify-between gap-2 px-2 py-1 rounded
                       hover:bg-gray-100 dark:hover:bg-slate-800
                       text-xs text-gray-700 dark:text-gray-200"
          >
            <span className="truncate min-w-0 flex-1">{summary.title}</span>
            <span className="tabular-nums text-[11px] text-gray-500 dark:text-gray-400 mr-1">
              {summary.percent}
            </span>
            {/* Nested tooltip: clicking the ring opens its own popover on top. */}
            <TokenRing phase={phase} variant="in-list" />
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Keep every phase that has a valid snapshot, including zero-token ones.
 *
 * Cursor-style UX: the gauge should stay visible from the moment a job
 * starts a node (T0 zero-seed), not blink in only after the first LLM
 * response. The ring itself renders an empty donut track at 0%, so a
 * freshly-seeded phase looks like a neutral placeholder until T1 (prompt
 * estimate) or T2 (first usage_partial) fills it in.
 *
 * The one thing we still hide is "phase object with no tokenUsage at all"
 * (defensive — shouldn't happen since `beginNodePhase` always seeds one).
 */
function filterActive(phases?: PhaseTokenUsage[]): PhaseTokenUsage[] {
  if (!phases || phases.length === 0) return [];
  return phases.filter((p) => p?.tokenUsage != null);
}

function ringKey(phase: PhaseTokenUsage, idx: number): string {
  if (typeof phase.workerId === 'number') return `w${phase.workerId}`;
  return `main-${idx}`;
}

/**
 * Decide how many rings fit inline and whether the "more" button is needed.
 *
 * Width math:
 *   - All `total` rings inline:     total*ringW + (total-1)*gap
 *   - N rings + more-button:        N*ringW + (N-1)*gap + gap + moreW   (N ≥ 1)
 *   - More-button only:             moreW
 *
 * Special case: when exactly ONE ring would be hidden behind the more-button,
 * rendering the ring directly is always cheaper because `ringW < moreW`
 * (14 < 22). We skip the more-button in that case so users see every gauge
 * whenever there is room for it.
 */
function computeVisibleCount(
  slotWidth: number,
  total: number,
  ringW: number,
  gap: number,
  moreW: number,
): { inlineCount: number; showMore: boolean } {
  if (total <= 0) return { inlineCount: 0, showMore: false };
  // If we haven't measured yet, render up to 3 to avoid layout thrash.
  if (slotWidth <= 0) return { inlineCount: Math.min(3, total), showMore: total > 3 };

  const fitsAll = total * ringW + (total - 1) * gap;
  if (fitsAll <= slotWidth) return { inlineCount: total, showMore: false };

  // Need the more button; reserve moreW + gap for it.
  const usable = slotWidth - moreW - gap;
  if (usable <= 0) return { inlineCount: 0, showMore: true };
  // Each inline ring costs ringW + gap.
  let inlineCount = Math.max(0, Math.floor((usable + gap) / (ringW + gap)));
  inlineCount = Math.min(inlineCount, total - 1);

  // Common-sense skip: if only ONE ring would be hidden, show it instead of
  // the more-button. Swapping moreW(22) for ringW(14) actually REDUCES total
  // width by 8px (moreW - ringW = 8; gap unchanged), so this always fits.
  if (total - inlineCount === 1) {
    return { inlineCount: total, showMore: false };
  }

  return { inlineCount, showMore: true };
}
