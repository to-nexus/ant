/**
 * Kanban task-queue broadcast for design decompose.
 *
 * Decompose-phase-local helper — only the four decompose files consume it
 * (docGen/revise/learn use `state.deps.kanbanUpdate.updateTaskQueue(...)`
 * directly with different signatures). Kept inside `nodes/decompose/`
 * per NODE_GRAPH_LAYOUT §2.2; promote to `nodes/_common/` only when a
 * second phase actually imports it.
 */

import type { DesignGraphState } from "../../state";
import type { DesignTask } from "../../../../types/task";
import {
  extractFirstJsonObject,
  prepareTagJson,
} from "../../../../../../core/utils/llmResponseParser";

export function updateKanban(
  state: DesignGraphState,
  currentTask: DesignTask | null,
  queue: DesignTask[],
  completed: any[] = [],
  recursionCount = 0,
): void {
  if (!state._httpJobId || !state.deps?.kanbanUpdate) return;
  state.deps.kanbanUpdate.updateTaskQueue(
    state._httpJobId,
    currentTask,
    queue,
    completed,
    recursionCount,
    undefined,
  );
}

/**
 * Streaming task accumulator for design decompose.
 *
 * Mirrors the code-decompose `accumulatedTasks` / `broadcastAccumulated`
 * pattern (`agents/architect/graph/code/nodes/decompose/index.ts` 540-600)
 * so design's per-`<task>` wrappers fill the Kanban todo column one task
 * at a time during tool-use (RAG) decompose runs.
 *
 * Wire-up: pass `onTaskParsed: hook.onTaskParsed` to `callLLMWithToolLoop`.
 * The tool loop runs the SSOT `XMLStreamParser` over each `event.text`
 * chunk and forwards `task_added` actions here.
 *
 * The hook is **dedup-aware** (skips tasks whose `id` was already
 * accumulated) and **silent on malformed input** (a task whose JSON body
 * fails parsing or omits `id`/`name` is skipped — the final
 * `parseLLMJsonResponse` surfaces any contract violation downstream).
 *
 * `reset()` is intended for systemDesignDecompose's repair-call path: when
 * the parse-and-validate round throws, the partial broadcast must be
 * cleared before the repair LLM call streams a fresh `<tasks>` block, or
 * the repaired tasks stack on top of the failed attempt's leftovers.
 *
 * `getAccumulated()` exposes the in-flight buffer for debugging /
 * downstream merging; callers should not mutate the returned array.
 */
export interface DesignTaskStreamingHook {
  onTaskParsed: (rawJson: string) => void;
  reset: () => void;
  getAccumulated: () => DesignTask[];
}

/**
 * Build a per-decompose-call streaming hook.
 *
 * Each sub-decompose (ui / system / gameArt) instantiates one hook before
 * calling `callLLMWithToolLoop`. The hook captures `state` in a closure,
 * so all broadcasts target the same `_httpJobId` / `kanbanUpdate` surface.
 */
export function createDesignTaskStreamingHook(
  state: DesignGraphState,
): DesignTaskStreamingHook {
  let accumulated: DesignTask[] = [];

  const broadcast = (): void => {
    if (!state._httpJobId || !state.deps?.kanbanUpdate) return;
    state.deps.kanbanUpdate.updateTaskQueue(
      state._httpJobId,
      null,
      accumulated,
      [],
      0,
      undefined,
    );
  };

  const onTaskParsed = (rawJson: string): void => {
    let raw: any;
    try {
      raw = JSON.parse(prepareTagJson(extractFirstJsonObject(rawJson)));
    } catch {
      return;
    }
    if (!raw || typeof raw !== 'object') return;

    const id = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : undefined;
    const name = typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : undefined;
    if (!id || !name) return;
    if (accumulated.some(t => t.id === id)) return;

    const minimal: DesignTask = {
      id,
      name,
      type: 'doc',
      priority: typeof raw.priority === 'number' ? raw.priority : 250,
      description: typeof raw.description === 'string' ? raw.description : '',
      targetFile: typeof raw.targetFile === 'string' ? raw.targetFile : undefined,
      completed: false,
    };
    accumulated.push(minimal);
    broadcast();
  };

  const reset = (): void => {
    if (accumulated.length === 0) return;
    accumulated = [];
    broadcast();
  };

  const getAccumulated = (): DesignTask[] => [...accumulated];

  return { onTaskParsed, reset, getAccumulated };
}
