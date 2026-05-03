import type { TouchedFromChatLog } from '../../../../../../core/context/breadcrumb';

interface TaskTouchedLike {
  touchedFiles?: string[];
}

export interface ResolveTouchedForLearnInputs {
  chatTouched?: TouchedFromChatLog;
  currentTask?: TaskTouchedLike | undefined;
  completedTasksDetails?: ReadonlyArray<TaskTouchedLike> | undefined;
}

function dedupeOrdered(items: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function deriveTouchedFromTaskState(
  currentTask: TaskTouchedLike | undefined,
  completedTasksDetails: ReadonlyArray<TaskTouchedLike> | undefined,
): TouchedFromChatLog | undefined {
  const ordered: string[] = [];
  for (const task of completedTasksDetails ?? []) {
    for (const filePath of task.touchedFiles ?? []) {
      ordered.push(filePath);
    }
  }
  for (const filePath of currentTask?.touchedFiles ?? []) {
    ordered.push(filePath);
  }
  const deduped = dedupeOrdered(ordered);
  if (deduped.length === 0) return undefined;
  // Task state currently stores "which files were touched", not op-level
  // create/edit/delete details. Keep conservative semantics by classifying
  // them as modified; chat-derived op buckets are merged later when present.
  return {
    all: new Set(deduped),
    created: [],
    modified: deduped,
    deleted: [],
  };
}

export function resolveTouchedForLearn(
  inputs: ResolveTouchedForLearnInputs,
): TouchedFromChatLog | undefined {
  const fromTaskState = deriveTouchedFromTaskState(
    inputs.currentTask,
    inputs.completedTasksDetails,
  );
  const fromChat = inputs.chatTouched;

  // chat.jsonl is asynchronous fire-and-forget; at learn timing it can be
  // partially flushed. Task state (`touchedFiles`) is synchronous and durable.
  if (!fromChat || fromChat.all.size === 0) {
    return fromTaskState;
  }
  if (!fromTaskState || fromTaskState.all.size === 0) {
    return fromChat;
  }

  // Merge both sources: keep chat op details/range when available, and
  // guarantee we do not lose files only visible in task-state snapshot.
  const mergedAll = new Set<string>([
    ...Array.from(fromTaskState.all),
    ...Array.from(fromChat.all),
  ]);
  const chatCreated = dedupeOrdered(fromChat.created);
  const chatDeleted = dedupeOrdered(fromChat.deleted);
  const chatModified = dedupeOrdered(fromChat.modified);
  const inCreated = new Set(chatCreated);
  const inDeleted = new Set(chatDeleted);
  const inModified = new Set(chatModified);

  const taskOnlyAsModified: string[] = [];
  for (const filePath of fromTaskState.modified) {
    if (!inCreated.has(filePath) && !inDeleted.has(filePath) && !inModified.has(filePath)) {
      taskOnlyAsModified.push(filePath);
    }
  }

  return {
    all: mergedAll,
    created: chatCreated,
    modified: dedupeOrdered([...chatModified, ...taskOnlyAsModified]),
    deleted: chatDeleted,
    range: fromChat.range,
  };
}

