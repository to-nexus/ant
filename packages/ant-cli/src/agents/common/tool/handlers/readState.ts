/**
 * read_state — the system's own state, two scopes.
 *
 * scope='run' (default): the run's in-memory task state (ahead of any on-disk
 * session checkpoint), so a later task can dig a prior task's FULL intent and
 * authored file manifest on demand. The `prior-completed-files` index shows a
 * truncated taste of each completed task; this is the `read_file`-equivalent
 * that returns the full body — symmetric to how `list_files` discovers and
 * `read_file` expands.
 *
 * scope='history': this feature's past conversation originals (user_turn /
 * assistant_turn since the last hard-reset boundary), INCLUDING turns already
 * folded into a `context_summary` checkpoint — the recall escape hatch when
 * an injected digest / rolling summary proves insufficient. Folding is a
 * prompt-surface concept; the originals stay on disk.
 *
 * Reads ONLY `ctx.completedTasks` / `ctx.featureHistory` — read-only
 * projections the job's tool node fills. The handler never imports graph
 * state (2-layer tool architecture, same pattern as `runningServers` /
 * `assetsRoot`). Not cacheable: both projections grow over time.
 */

import type { ToolHandler } from '../types';

function detail(t: {
  name: string;
  type: string;
  band?: string;
  description: string;
  files: string[];
}): string {
  const band = t.band ? ` · ${t.band}` : '';
  const desc = t.description.trim() || '(no description)';
  const files = t.files.length
    ? t.files.map((f) => `  - ${f}`).join('\n')
    : '  (no files authored)';
  return `### ${t.name}  [${t.type}${band}]\n${desc}\n\nFiles:\n${files}`;
}

export const handleReadState: ToolHandler = async (ctx, args) => {
  const queryRaw = typeof args.task === 'string' ? args.task.trim() : '';
  // Progress half — paired with the `read_state` terminal status below,
  // mirroring how list_files/read_file emit their dedicated card pair.
  const idx = await ctx.chatStatus.showStatus('reading_state', {
    task: queryRaw || undefined,
  });

  if (args.scope === 'history') {
    return readHistory(ctx, queryRaw, idx);
  }

  const tasks = ctx.completedTasks ?? [];
  if (tasks.length === 0) {
    await ctx.chatStatus.showStatus('read_state', { taskCount: 0, _mergeIndex: idx });
    return { content: 'No tasks have completed yet in this run.' };
  }

  if (!queryRaw) {
    // No filter → compact roster (discovery), mirroring list_files.
    const roster = tasks
      .map((t) => {
        const band = t.band ? ` · ${t.band}` : '';
        return `- ${t.name} [${t.type}${band}] (${t.files.length} file${t.files.length === 1 ? '' : 's'})`;
      })
      .join('\n');
    await ctx.chatStatus.showStatus('read_state', { taskCount: tasks.length, _mergeIndex: idx });
    return {
      content: `${tasks.length} task(s) completed in this run. Pass \`task\` (a name or id below) to read one's full scope + file manifest.\n\n${roster}`,
    };
  }

  const q = queryRaw.toLowerCase();
  const matched = tasks.filter(
    (t) => t.id.toLowerCase() === q || t.id.toLowerCase().includes(q) || t.name.toLowerCase().includes(q),
  );
  await ctx.chatStatus.showStatus('read_state', {
    task: queryRaw,
    matchedCount: matched.length,
    _mergeIndex: idx,
  });
  if (matched.length === 0) {
    return {
      content: `No completed task matches "${queryRaw}". ${tasks.length} task(s) completed — call read_state with no argument to list them.`,
    };
  }
  return { content: matched.map(detail).join('\n\n') };
};

// ─── scope='history' — past-conversation recall ─────────────────────────────

/** Roster line cap; full bodies are only returned for query matches. */
const HISTORY_ROSTER_PREVIEW_CHARS = 100;
/** Most-recent turns listed when no query is given. */
const HISTORY_ROSTER_LIMIT = 30;

type HistoryTurn = {
  turnId: string;
  ts: string;
  jobType?: string;
  userText: string;
  assistantFinalText?: string;
  ephemeral?: boolean;
};

function historyDetail(t: HistoryTurn): string {
  const meta = [t.ts, t.jobType, t.ephemeral ? 'ask' : ''].filter(Boolean).join(' · ');
  const assistant = t.assistantFinalText ? `\n\nAssistant:\n${t.assistantFinalText}` : '';
  return `### ${t.turnId}  [${meta}]\nUser:\n${t.userText}${assistant}`;
}

async function readHistory(
  ctx: Parameters<ToolHandler>[0],
  queryRaw: string,
  idx: string | undefined,
): Promise<{ content: string }> {
  if (!ctx.featureHistory) {
    await ctx.chatStatus.showStatus('read_state', { taskCount: 0, _mergeIndex: idx });
    return { content: 'Feature history is not available in this job context.' };
  }
  const turns = await ctx.featureHistory();
  if (turns.length === 0) {
    await ctx.chatStatus.showStatus('read_state', { taskCount: 0, _mergeIndex: idx });
    return { content: 'No past turns recorded for this feature yet.' };
  }

  if (!queryRaw) {
    const recent = turns.slice(-HISTORY_ROSTER_LIMIT);
    const roster = recent
      .map((t) => {
        const preview = t.userText.replace(/\s+/g, ' ').slice(0, HISTORY_ROSTER_PREVIEW_CHARS);
        return `- ${t.turnId} [${t.ts}${t.jobType ? ` · ${t.jobType}` : ''}] ${preview}`;
      })
      .join('\n');
    await ctx.chatStatus.showStatus('read_state', { taskCount: turns.length, _mergeIndex: idx });
    return {
      content: `${turns.length} past turn(s) in this feature (showing last ${recent.length}). Pass \`task\` (a turn id or search text) to read one verbatim.\n\n${roster}`,
    };
  }

  const q = queryRaw.toLowerCase();
  const matched = turns.filter(
    (t) =>
      t.turnId.toLowerCase() === q ||
      t.userText.toLowerCase().includes(q) ||
      (t.assistantFinalText ?? '').toLowerCase().includes(q),
  );
  await ctx.chatStatus.showStatus('read_state', {
    task: queryRaw,
    matchedCount: matched.length,
    _mergeIndex: idx,
  });
  if (matched.length === 0) {
    return {
      content: `No past turn matches "${queryRaw}". ${turns.length} turn(s) recorded — call read_state with scope='history' and no \`task\` to list them.`,
    };
  }
  return { content: matched.map(historyDetail).join('\n\n') };
}
