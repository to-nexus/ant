import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import type { TraceLine } from '@ant/shared';

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
  const status = useStore(s => s.traceStatus);
  const error = useStore(s => s.traceError);

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
        <TurnBlock key={group.turnId} group={group} />
      ))}
    </div>
  );
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

function TurnBlock({ group }: { group: TurnGroup }) {
  return (
    <article className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-white/[0.02] shadow-sm">
      <header className="flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-[10px] uppercase tracking-wide">
            {group.jobType}
          </span>
          <span className="font-mono">{group.turnId}</span>
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
