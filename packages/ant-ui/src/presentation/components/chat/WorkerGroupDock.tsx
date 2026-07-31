/**
 * WorkerGroupDock — fixed strip above the chat input giving one-click access
 * to the parallel tasks that are RUNNING RIGHT NOW.
 *
 * Live-only by design, with one deliberate exception: a chip does not vanish
 * the instant its task settles. It is held for a short farewell — outcome
 * glyph, a matching flash, then a fade — so the completion registers instead
 * of the strip silently losing an item. After the window the chip is gone and
 * the work lives only in the scrollback, where `WorkerGroupSection` renders
 * its ✓ / ✗ and the group can be expanded in place.
 *
 * Bottom placement keeps the top edge single-owner for PinnedQuery's inset
 * math.
 */

import { memo, useMemo } from 'react';
import { Check, XCircle } from 'lucide-react';
import { useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import type { Turn, TurnSection } from '@/domain/store/selectors/chat';
import { Spinner } from '@/presentation/components/common/async';
import {
  SETTLE_FADE_OUT_MS,
  SETTLE_FAREWELL_MS,
  useSettlingExit,
} from '@/presentation/components/common/motion';
import {
  isWorkerGroupScope,
  parseWorkerScope,
  sectionStatus,
  sectionTaskName,
  workerHue,
  workerTintFg,
  type WorkerGroupStatus,
} from './workerGroupPolicy';

export interface WorkerGroupDockProps {
  turns: Turn[];
}

/**
 * `active` — running. `completed` / `failed` — settling out (terminal state
 * known). `unknown` — settling out because the JOB died before this scope's
 * marker landed; we hold the chip for the exit but claim no outcome.
 */
type ChipPhase = WorkerGroupStatus | 'unknown';

interface DockChip {
  turnId: string;
  workerScope: string;
  label: string;
  workerId?: number;
  phase: ChipPhase;
}

function workerChipSections(turn: Turn | undefined): TurnSection[] {
  if (!turn) return [];
  return turn.sections.filter((s) => isWorkerGroupScope(s.workerScope));
}

function toChip(turn: Turn, section: TurnSection, phase: ChipPhase): DockChip {
  const parsed = parseWorkerScope(section.workerScope);
  return {
    turnId: turn.turnId,
    workerScope: section.workerScope,
    label: sectionTaskName(section) ?? parsed?.taskKey ?? section.workerScope,
    workerId: parsed?.workerId,
    phase,
  };
}

/** Outcome colour for the flash + glyph. `unknown` gets no accent. */
function settleColor(phase: ChipPhase): string | undefined {
  if (phase === 'completed') return 'var(--status-done-fg)';
  if (phase === 'failed') return 'var(--red-500)';
  return undefined;
}

function ChipGlyph({
  phase,
  hue,
  reduceMotion,
}: {
  phase: ChipPhase;
  hue: number;
  reduceMotion: boolean;
}) {
  if (phase === 'active') {
    return (
      <span className="inline-flex flex-shrink-0" style={{ color: workerTintFg(hue) }}>
        <Spinner size="sm" tone="inherit" />
      </span>
    );
  }
  if (phase === 'unknown') return null;
  const Icon = phase === 'completed' ? Check : XCircle;
  return (
    <Icon
      className="w-3 h-3 flex-shrink-0"
      strokeWidth={3}
      style={{
        color: settleColor(phase),
        // Pops in as the spinner is replaced — the moment of completion.
        // Under reduced motion the glyph still swaps; it just doesn't pop.
        ...(reduceMotion ? {} : { animation: 'sparkle-pop 420ms var(--ease-spring) both' }),
      }}
    />
  );
}

export const WorkerGroupDock = memo(function WorkerGroupDock({ turns }: WorkerGroupDockProps) {
  const { t } = useTranslation('chat');
  const expandChatGroup = useStore((s) => s.expandChatGroup);
  const requestChatJump = useStore((s) => s.requestChatJump);
  const isRunning = useStore((s) => s.isRunning);
  const currentJobId = useStore((s) => s.currentJobId);
  const reduceMotion = useReducedMotion();

  const last = turns[turns.length - 1];

  // Job-liveness floor. Chip membership already drops settled scopes, but that
  // depends on the BE marker having landed — a killed worker, a crashed
  // server, or a chat.jsonl recorded before the marker existed would leave
  // scopes permanently "open". Binding the dock to the live job makes its
  // disappearance at job end structural rather than signal-dependent.
  //
  // The floor forces DEPARTURE, not an instant unmount: scopes still open when
  // the job dies flow through the same farewell as a normal completion (as
  // `unknown`, since no outcome was ever reported), so the last task of a run
  // — the one that ends the job — still gets acknowledged.
  const live = isRunning && !!last && !!currentJobId && last.jobId === currentJobId;

  const sections = useMemo(() => workerChipSections(last), [last]);

  const activeIds = useMemo(
    () =>
      live
        ? sections.filter((s) => sectionStatus(s) === 'active').map((s) => s.workerScope)
        : [],
    [live, sections],
  );

  const { settlingIds } = useSettlingExit(activeIds);

  const chips = useMemo(() => {
    if (!last) return [];
    const out: DockChip[] = [];
    for (const section of sections) {
      const status = sectionStatus(section);
      if (live && status === 'active') {
        out.push(toChip(last, section, 'active'));
        continue;
      }
      if (!settlingIds.has(section.workerScope)) continue;
      // Settling: show the real outcome when the marker landed, otherwise a
      // neutral exit — never a check for something we did not see succeed.
      out.push(toChip(last, section, status === 'active' ? 'unknown' : status));
    }
    return out;
  }, [last, sections, live, settlingIds]);

  if (chips.length === 0) return null;

  return (
    <div
      className="flex items-center gap-1.5 px-3 overflow-x-auto flex-shrink-0"
      style={{
        height: 36,
        background: 'var(--bg-surface)',
        borderTop: '1px solid var(--border-1)',
      }}
      aria-label={t('workerGroup.dockLabel')}
    >
      {chips.map((chip) => {
        const hue = workerHue(chip.workerId);
        const settling = chip.phase !== 'active';
        const glow = settleColor(chip.phase);
        return (
          <button
            key={`${chip.turnId}:${chip.workerScope}`}
            type="button"
            title={t('workerGroup.jumpTo', { label: chip.label })}
            onClick={() => {
              // Expand BEFORE the jump so the target has its final height
              // when ChatHistory's fine-scroll runs.
              expandChatGroup(chip.turnId, chip.workerScope);
              requestChatJump(chip.turnId, chip.workerScope);
            }}
            className="inline-flex items-center gap-1.5 px-2 flex-shrink-0 cursor-pointer min-w-0"
            style={{
              height: 24,
              maxWidth: 180,
              borderRadius: 'var(--r-pill)',
              border: '1px solid var(--border-1)',
              // Worker identity survives as a left accent bar — the `W{n}`
              // text badge carried no meaning the hue doesn't. While settling
              // the accent switches to the outcome colour.
              ...(chip.workerId !== undefined || glow
                ? { borderLeft: `3px solid ${glow ?? workerTintFg(hue)}` }
                : {}),
              background: 'var(--bg-surface-2)',
              ...(settling && !reduceMotion
                ? {
                    ['--chip-settle-glow' as string]: glow ?? 'transparent',
                    animation: [
                      `chip-settle-flash ${SETTLE_FAREWELL_MS - SETTLE_FADE_OUT_MS}ms var(--ease-smooth) 1`,
                      `chip-settle-out ${SETTLE_FADE_OUT_MS}ms var(--ease-smooth) ${SETTLE_FAREWELL_MS - SETTLE_FADE_OUT_MS}ms both`,
                    ].join(', '),
                  }
                : {}),
            }}
          >
            <span className="text-[11px] truncate min-w-0" style={{ color: 'var(--text-2)' }}>
              {chip.label}
            </span>
            <ChipGlyph phase={chip.phase} hue={hue} reduceMotion={!!reduceMotion} />
          </button>
        );
      })}
    </div>
  );
});
