import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import type {
  TraceLine,
  FeatureUserTurnLine,
  FeatureUserTurnMetaLine,
} from '@ant/shared';

/**
 * Trace-based activity view — chat history derived from trace.jsonl,
 * grouped by turnId (§16 `ui_render_migration` AC: "chat render grouped by turnId").
 *
 * Each turn is shown as a conversation block:
 * - user_turn line → user bubble
 * - thinking / tool_call / file_write / run_command / job_status → assistant activity
 * - assistant_message → assistant text bubble
 *
 * This view is the read-only SSOT. Live streaming events + interactive
 * choice cards remain in the legacy `Chat` tab during the transition.
 */
export function TraceActivityView() {
  const { t } = useTranslation('chat');
  const traceLines = useStore(s => s.traceLines);
  const userTurns = useStore(s => s.userTurns);
  const userTurnMetas = useStore(s => s.userTurnMetas);
  const status = useStore(s => s.traceStatus);
  const error = useStore(s => s.traceError);

  const tierByTurnId = useMemo(
    () => buildTierIndex(userTurns, userTurnMetas),
    [userTurns, userTurnMetas],
  );
  const groups = useMemo(() => groupByTurn(traceLines), [traceLines]);

  if (status === 'loading' && groups.length === 0) {
    return (
      <div className="flex items-center justify-center p-6 text-sm text-gray-500 dark:text-gray-400">
        {t('activity.loading', { defaultValue: 'Loading activity…' })}
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="p-4 text-sm text-red-600 dark:text-red-400">
        {t('activity.loadError', { defaultValue: 'Failed to load activity feed.' })}
        {error ? <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{error}</div> : null}
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center">
        <div className="text-3xl mb-3 opacity-60">📜</div>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {t('activity.empty', {
            defaultValue: 'No recorded activity yet. User turns and job events will appear here.',
          })}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-4">
      {groups.map(group => (
        <TurnBlock
          key={group.turnId}
          group={group}
          tier={tierByTurnId.get(group.turnId)}
        />
      ))}
    </div>
  );
}

/**
 * Tier info merged from feature.jsonl user_turn + user_turn_meta by turnId.
 * All fields are optional — only renders the badges that actually exist
 * (`mode` always comes from user_turn, `complexity/decidedBy/reason`
 * from the paired user_turn_meta once Decompose finishes).
 */
interface TierInfo {
  mode?: FeatureUserTurnLine['mode'];
  complexity?: FeatureUserTurnMetaLine['complexity'];
  decidedBy?: FeatureUserTurnMetaLine['decidedBy'];
  reason?: FeatureUserTurnMetaLine['reason'];
}

function buildTierIndex(
  userTurns: FeatureUserTurnLine[],
  userTurnMetas: FeatureUserTurnMetaLine[],
): Map<string, TierInfo> {
  const byTurn = new Map<string, TierInfo>();
  for (const turn of userTurns) {
    if (!turn.turnId) continue;
    const entry = byTurn.get(turn.turnId) ?? {};
    if (turn.mode) entry.mode = turn.mode;
    byTurn.set(turn.turnId, entry);
  }
  for (const meta of userTurnMetas) {
    if (!meta.turnId) continue;
    const entry = byTurn.get(meta.turnId) ?? {};
    entry.complexity = meta.complexity;
    entry.decidedBy = meta.decidedBy;
    entry.reason = meta.reason;
    byTurn.set(meta.turnId, entry);
  }
  return byTurn;
}

interface TurnGroup {
  turnId: string;
  jobId: string;
  jobType: string;
  firstTs: string;
  userText?: string;
  events: TraceLine[];
}

function groupByTurn(lines: TraceLine[]): TurnGroup[] {
  const byTurn = new Map<string, TurnGroup>();
  for (const line of lines) {
    if (line.collapsed) continue;
    const key = line.turnId || '__untagged__';
    let group = byTurn.get(key);
    if (!group) {
      group = {
        turnId: key,
        jobId: line.jobId,
        jobType: line.jobType,
        firstTs: line.ts,
        events: [],
      };
      byTurn.set(key, group);
    }
    if (line.ts < group.firstTs) group.firstTs = line.ts;
    if (line.type === 'user_turn') {
      group.userText = line.text;
    } else {
      group.events.push(line);
    }
  }

  const groups = Array.from(byTurn.values());
  groups.sort((a, b) => (a.firstTs < b.firstTs ? -1 : a.firstTs > b.firstTs ? 1 : 0));
  for (const g of groups) {
    g.events.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  }
  return groups;
}

function TurnBlock({ group, tier }: { group: TurnGroup; tier?: TierInfo }) {
  return (
    <article className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-white/[0.02] shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-800">
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-[10px] uppercase tracking-wide">
            {group.jobType}
          </span>
          <span className="font-mono">{group.turnId}</span>
          {tier ? <TierBadges tier={tier} /> : null}
        </div>
        <time className="text-[11px] text-gray-400 dark:text-gray-500">{formatTs(group.firstTs)}</time>
      </header>

      <div className="px-3 py-3 space-y-3">
        {group.userText ? (
          <div className="flex justify-end">
            <div className="max-w-[85%] rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200/60 dark:border-blue-800/40 px-3 py-2 text-sm text-gray-800 dark:text-gray-100 whitespace-pre-wrap">
              {group.userText}
            </div>
          </div>
        ) : null}

        {group.events.length > 0 ? (
          <div className="space-y-1.5">
            {group.events.map((event, idx) => (
              <EventRow key={`${event.type}-${event.ts}-${idx}`} event={event} />
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

/**
 * Read-only tier badges for a user_turn.
 *
 * Shows whichever of `mode / complexity / decidedBy / reason` is present
 * — `reason` is gated behind the user's hover (title attribute) to keep
 * the header compact. No interactions; overrule is an explicit follow-up
 * plan (see §18).
 */
function TierBadges({ tier }: { tier: TierInfo }) {
  const { t } = useTranslation('chat');
  const modeClass = tier.mode ? MODE_CLASSES[tier.mode] : undefined;
  const complexityClass = tier.complexity ? COMPLEXITY_CLASSES[tier.complexity] : undefined;
  const decidedByClass = tier.decidedBy ? DECIDED_BY_CLASSES[tier.decidedBy] : undefined;

  if (!tier.mode && !tier.complexity && !tier.decidedBy && !tier.reason) return null;

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {tier.mode ? (
        <span
          className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${modeClass ?? NEUTRAL_CLASS}`}
          title={t('tier.modeTooltip', { defaultValue: 'Mode' })}
        >
          {tier.mode}
        </span>
      ) : null}
      {tier.complexity ? (
        <span
          className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${complexityClass ?? NEUTRAL_CLASS}`}
          title={t('tier.complexityTooltip', { defaultValue: 'Complexity' })}
        >
          {tier.complexity}
        </span>
      ) : null}
      {tier.decidedBy ? (
        <span
          className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${decidedByClass ?? NEUTRAL_CLASS}`}
          title={t('tier.decidedByTooltip', { defaultValue: 'Decided by' })}
        >
          {tier.decidedBy}
        </span>
      ) : null}
      {tier.reason ? (
        <span
          className="inline-flex max-w-[12rem] items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 truncate"
          title={tier.reason}
        >
          {truncate(tier.reason, 32)}
        </span>
      ) : null}
    </span>
  );
}

const NEUTRAL_CLASS =
  'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300';

const MODE_CLASSES: Record<NonNullable<TierInfo['mode']>, string> = {
  explain: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300',
  generate: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
  refactor: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300',
};

const COMPLEXITY_CLASSES: Record<NonNullable<TierInfo['complexity']>, string> = {
  oneshot: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300',
  exploratory: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
  todo: 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300',
};

const DECIDED_BY_CLASSES: Record<NonNullable<TierInfo['decidedBy']>, string> = {
  llm: 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200/60 dark:border-blue-800/40',
  heuristic:
    'bg-yellow-50 dark:bg-yellow-950/40 text-yellow-700 dark:text-yellow-300 border border-yellow-200/60 dark:border-yellow-800/40',
  user: 'bg-pink-50 dark:bg-pink-950/40 text-pink-700 dark:text-pink-300 border border-pink-200/60 dark:border-pink-800/40',
};

function EventRow({ event }: { event: TraceLine }) {
  switch (event.type) {
    case 'assistant_thinking':
      return (
        <div className="text-xs italic text-gray-500 dark:text-gray-400 pl-2 border-l-2 border-gray-200 dark:border-gray-700">
          {truncate(event.text, 240)}
        </div>
      );
    case 'tool_call':
      return (
        <div className="text-xs text-gray-700 dark:text-gray-300 font-mono pl-2 border-l-2 border-amber-300 dark:border-amber-700/60">
          <span className="text-amber-700 dark:text-amber-300">tool</span>
          <span className="mx-1">›</span>
          <span>{event.tool}</span>
          {event.error ? <span className="ml-2 text-red-500">({event.error})</span> : null}
        </div>
      );
    case 'file_write': {
      const op = event.operation ?? 'update';
      const opClass =
        op === 'create'
          ? 'text-emerald-600 dark:text-emerald-400'
          : op === 'delete'
            ? 'text-red-600 dark:text-red-400'
            : 'text-blue-600 dark:text-blue-400';
      return (
        <div className="text-xs text-gray-700 dark:text-gray-300 font-mono pl-2 border-l-2 border-emerald-300 dark:border-emerald-700/60">
          <span className={opClass}>{op}</span>
          <span className="mx-1">›</span>
          <span>{event.path}</span>
        </div>
      );
    }
    case 'run_command':
      return (
        <div className="text-xs text-gray-700 dark:text-gray-300 font-mono pl-2 border-l-2 border-purple-300 dark:border-purple-700/60">
          <span className="text-purple-700 dark:text-purple-300">$</span>
          <span className="ml-1">{truncate(event.cmd, 160)}</span>
          {typeof event.exitCode === 'number' && event.exitCode !== 0 ? (
            <span className="ml-2 text-red-500">exit {event.exitCode}</span>
          ) : null}
        </div>
      );
    case 'job_status':
      return (
        <div className="text-xs text-gray-500 dark:text-gray-400 pl-2 border-l-2 border-gray-300 dark:border-gray-700">
          {event.phase}
          {event.message ? <span className="ml-2 text-gray-400">— {truncate(event.message, 160)}</span> : null}
        </div>
      );
    case 'assistant_message':
      return (
        <div className="flex justify-start">
          <div className="max-w-[90%] rounded-xl bg-gray-50 dark:bg-gray-900/60 border border-gray-200/60 dark:border-gray-700/50 px-3 py-2 text-sm text-gray-800 dark:text-gray-100 whitespace-pre-wrap">
            {event.text}
          </div>
        </div>
      );
    case 'user_turn':
      return null;
    default:
      return null;
  }
}

function truncate(text: string, limit: number): string {
  if (!text) return '';
  if (text.length <= limit) return text;
  return text.slice(0, limit) + '…';
}

function formatTs(ts: string): string {
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return ts;
    return d.toLocaleString();
  } catch {
    return ts;
  }
}
