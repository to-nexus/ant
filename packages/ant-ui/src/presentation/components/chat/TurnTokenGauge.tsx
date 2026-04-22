import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { useStore } from '@/domain/store';
import { type PhaseTokenUsage } from '@ant/shared';
import { Tooltip } from '@/presentation/components/common/Tooltip';
import { BatteryGauge, summarizeBattery } from './BatteryGauge';

/**
 * Chat-input token gauge — one battery per active graph-node / worker.
 *
 * Layout policy:
 *  - 1 battery (sequential / main graph) → renders inline.
 *  - N batteries (parallel workers) → renders as many as fit horizontally;
 *    overflow collapses into a "⋯ more" button whose dropdown lists every
 *    battery. Each dropdown row exposes a nested tooltip for its battery.
 *  - Width measurement uses `ResizeObserver` on the wrapping container, so
 *    the visible count adapts to the toolbar's available width (which itself
 *    shrinks with `AgentJobToolbar`'s icon-only breakpoints).
 */
export function TurnTokenGauge() {
  const phases = useStore((state) => state.kanban?.currentPhaseTokenUsages);
  const visiblePhases = useMemo(() => filterActive(phases), [phases]);

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

  // Geometry (keep in sync with BatteryGauge + AgentJobToolbar min-width math):
  //   battery    = 26 body + 2 cap = 28px
  //   gap        = 4px between batteries
  //   more btn   = 22px
  const BATTERY_W = 28;
  const GAP = 4;
  const MORE_W = 22;

  const fit = computeVisibleCount(slotWidth, visiblePhases.length, BATTERY_W, GAP, MORE_W);

  const inline = visiblePhases.slice(0, fit.inlineCount);
  const overflow = visiblePhases.slice(fit.inlineCount);

  return (
    <div
      ref={hostRef}
      className="flex items-center gap-1 min-w-0 overflow-hidden flex-1 justify-end"
    >
      {inline.map((phase, idx) => (
        <BatteryGauge key={batteryKey(phase, idx)} phase={phase} />
      ))}
      {overflow.length > 0 && <MoreBatteriesDropdown phases={overflow} />}
    </div>
  );
}

interface MoreBatteriesDropdownProps {
  phases: PhaseTokenUsage[];
}

/**
 * "More" button that opens a vertical list of the remaining batteries.
 * Reuses the common <Tooltip/> as the dropdown container so nested tooltips
 * (one per row) work out-of-the-box — each row's battery lives in its own
 * Tooltip rendered on top via portal.
 */
function MoreBatteriesDropdown({ phases }: MoreBatteriesDropdownProps) {
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
        aria-label={`${phases.length} more gauges`}
        title={`${phases.length} more`}
      >
        <MoreHorizontal className="w-3 h-3" />
      </button>
    </Tooltip>
  );
}

function MoreDropdownList({ phases }: { phases: PhaseTokenUsage[] }) {
  return (
    <ul className="flex flex-col gap-0.5 min-w-[180px] max-h-[240px] overflow-y-auto">
      {phases.map((phase, idx) => {
        const summary = summarizeBattery(phase);
        return (
          <li
            key={batteryKey(phase, idx)}
            className="flex items-center justify-between gap-2 px-2 py-1 rounded
                       hover:bg-gray-100 dark:hover:bg-slate-800
                       text-xs text-gray-700 dark:text-gray-200"
          >
            <span className="truncate min-w-0 flex-1">{summary.title}</span>
            <span className="tabular-nums text-[11px] text-gray-500 dark:text-gray-400 mr-1">
              {summary.percent}
            </span>
            {/* Nested tooltip: clicking the battery opens its own popover on top. */}
            <BatteryGauge phase={phase} variant="in-list" />
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Keep phases whose snapshot carries at least one non-zero token count.
 * Empty/zero snapshots appear briefly at node entry before the first LLM
 * response and would render as "empty batteries" — hide them until data lands.
 */
function filterActive(phases?: PhaseTokenUsage[]): PhaseTokenUsage[] {
  if (!phases || phases.length === 0) return [];
  return phases.filter(
    (p) => (p?.tokenUsage?.inputTokens ?? 0) + (p?.tokenUsage?.outputTokens ?? 0) > 0,
  );
}

function batteryKey(phase: PhaseTokenUsage, idx: number): string {
  if (typeof phase.workerId === 'number') return `w${phase.workerId}`;
  return `main-${idx}`;
}

/**
 * Decide how many batteries fit inline. When every battery fits, skip the
 * more-button entirely. Otherwise reserve space for the more-button and
 * fit as many batteries as the remaining slot allows.
 */
function computeVisibleCount(
  slotWidth: number,
  total: number,
  batteryW: number,
  gap: number,
  moreW: number,
): { inlineCount: number } {
  if (total <= 0) return { inlineCount: 0 };
  // If we haven't measured yet, render up to 3 to avoid layout thrash.
  if (slotWidth <= 0) return { inlineCount: Math.min(3, total) };

  const fitsAll = total * batteryW + (total - 1) * gap;
  if (fitsAll <= slotWidth) return { inlineCount: total };

  // Need the more button; reserve moreW + gap for it.
  const usable = slotWidth - moreW - gap;
  if (usable <= 0) return { inlineCount: 0 };
  // Each inline battery costs batteryW + gap (the last item has no trailing gap
  // before the more button, but we need one gap between batteries and one
  // between the last battery and the more button — same count).
  const inlineCount = Math.max(0, Math.floor((usable + gap) / (batteryW + gap)));
  return { inlineCount: Math.min(inlineCount, total - 1) };
}
