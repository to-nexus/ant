/**
 * read_state — live run-state reader.
 *
 * Returns the run's in-memory task state (ahead of any on-disk session
 * checkpoint), so a later task can dig a prior task's FULL intent and authored
 * file manifest on demand. The `prior-completed-files` index shows a truncated
 * taste of each completed task; this is the `read_file`-equivalent that returns
 * the full body — symmetric to how `list_files` discovers and `read_file`
 * expands.
 *
 * Reads ONLY `ctx.completedTasks` — a read-only projection the code tool node
 * fills from `state.completedTasksDetails`. The handler never imports graph
 * state (2-layer tool architecture, same pattern as `runningServers` /
 * `assetsRoot`). Not cacheable: the projection grows as tasks complete.
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
  const tasks = ctx.completedTasks ?? [];
  if (tasks.length === 0) {
    return { content: 'No tasks have completed yet in this run.' };
  }

  const queryRaw = typeof args.task === 'string' ? args.task.trim() : '';
  if (!queryRaw) {
    // No filter → compact roster (discovery), mirroring list_files.
    const roster = tasks
      .map((t) => {
        const band = t.band ? ` · ${t.band}` : '';
        return `- ${t.name} [${t.type}${band}] (${t.files.length} file${t.files.length === 1 ? '' : 's'})`;
      })
      .join('\n');
    return {
      content: `${tasks.length} task(s) completed in this run. Pass \`task\` (a name or id below) to read one's full scope + file manifest.\n\n${roster}`,
    };
  }

  const q = queryRaw.toLowerCase();
  const matched = tasks.filter(
    (t) => t.id.toLowerCase() === q || t.id.toLowerCase().includes(q) || t.name.toLowerCase().includes(q),
  );
  if (matched.length === 0) {
    return {
      content: `No completed task matches "${queryRaw}". ${tasks.length} task(s) completed — call read_state with no argument to list them.`,
    };
  }
  return { content: matched.map(detail).join('\n\n') };
};
