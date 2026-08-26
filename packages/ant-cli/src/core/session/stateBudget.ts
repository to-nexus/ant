/**
 * Session write budget — the write half of the `SESSION_MAX_BYTES` contract.
 *
 * `SESSION_MAX_BYTES` was a READ-only refusal: every reader bounded itself, but
 * nothing stopped a writer from producing a file no reader could ever open
 * again. `FileSessionAdapter.load()` throws past the budget and
 * `updateArtifacts()` starts with `load()`, so a session that crossed the line
 * became permanently unreadable AND unwritable — the system could brick its own
 * state (M-NEW-029).
 *
 * The rule this module owns: **never write a session you cannot read back.**
 * Same constant, same comparison as the readers — one contract, not two
 * numbers. Over-budget is not an immediate refusal: `shedToFit` sheds the
 * recoverable parts in a fixed order first, and only a session that still does
 * not fit is refused, with the previous valid file left untouched.
 */

import { SESSION_MAX_BYTES, readSessionTextContained } from '../utils/sessionPaths';
import { atomicWriteFile } from '../utils/atomicWriteFile';
import { createHash } from 'crypto';
import { groupMessagesIntoTurns } from '../context/types';
import type { ConversationMessage } from '../context/types';

/**
 * Byte budget for one conversation array on disk.
 *
 * Derived, not a second magic number. Deliberately generous: tool results are
 * already token-capped upstream (`toolResultManager`), so growth is driven by
 * round count, and this trim is a last-resort against the pathological case —
 * not a context policy. Halving `SESSION_MAX_BYTES` leaves the rest of the
 * session (task queue, runs, checklist) its own room under the same ceiling.
 *
 * A function, not a const: a module-level value derived from another module's
 * export is computed at import time and comes out `NaN` wherever that module is
 * partially mocked.
 */
export function conversationByteBudget(): number {
  return Math.floor(SESSION_MAX_BYTES / 2);
}

/** Newest turn-groups a trim always keeps, whatever the budget says. */
export const TRIM_MIN_KEEP_TURNS = 4;

/**
 * Constant by design. A varying value (a dropped-turn count, a timestamp)
 * changes the cached prompt prefix on every turn and silently destroys prompt
 * caching — the count belongs in the log line, not in the message.
 */
export const TRIM_BRIDGE_TEXT =
  '[Earlier conversation was trimmed to fit the session size budget.]';

export class SessionWriteTooLargeError extends Error {
  readonly code = 'SESSION_WRITE_TOO_LARGE' as const;
  constructor(readonly sessionPath: string, readonly bytes: number, readonly limit: number) {
    super(`Session too large to write: ${sessionPath} (${bytes} > ${limit} bytes)`);
  }
}

export interface ConversationTrimResult {
  messages: ConversationMessage[];
  droppedTurns: number;
  bytesBefore: number;
  bytesAfter: number;
  trimmed: boolean;
}

const byteLength = (value: unknown): number => Buffer.byteLength(JSON.stringify(value) ?? '', 'utf-8');

/**
 * Drop WHOLE turn groups from the OLDEST end until the serialized array fits.
 *
 * Group granularity is what makes this safe: `groupMessagesIntoTurns` opens a
 * group at each assistant message, and a tool_use's matching tool_result is
 * always the user message right after it — so a `tool_use` and its
 * `tool_result` live in the same group and are kept or dropped together. There
 * is no cross-group pair to orphan.
 *
 * Guarantees (pinned by tests — they are the whole proof):
 *   1. `result[0].role === 'user'` (leading anchor, or the bridge)
 *   2. `result.at(-1) === history.at(-1)` — IDENTITY, not equality. Clarify
 *      resume reads only the last message, so nothing may ever be appended
 *      after the tail; a note added at the end would silently break it.
 *   3. every surviving `tool_result` still has its `tool_use`
 *   4. groups are whole, and the newest `minKeepTurns` always survive
 */
export function trimConversationToByteBudget(
  history: ConversationMessage[],
  opts?: { budgetBytes?: number; minKeepTurns?: number },
): ConversationTrimResult {
  const budgetBytes = opts?.budgetBytes ?? conversationByteBudget();
  const minKeepTurns = opts?.minKeepTurns ?? TRIM_MIN_KEEP_TURNS;
  const bytesBefore = byteLength(history);

  if (history.length === 0 || bytesBefore <= budgetBytes) {
    return { messages: history, droppedTurns: 0, bytesBefore, bytesAfter: bytesBefore, trimmed: false };
  }

  const groups = groupMessagesIntoTurns(history);
  // A leading all-user group is the opening directive: keep it when it fits so
  // the transcript still starts the way the model saw it.
  const hasAnchor = groups.length > 0 && groups[0].every((m) => m.role === 'user');
  const anchor = hasAnchor ? groups[0] : [];
  const firstDroppable = hasAnchor ? 1 : 0;
  const bridge: ConversationMessage = { role: 'user', content: TRIM_BRIDGE_TEXT };

  const floorStart = Math.max(firstDroppable, groups.length - minKeepTurns);
  let start = floorStart;
  const fits = (from: number, withAnchor: boolean): boolean =>
    byteLength([...(withAnchor ? anchor : []), bridge, ...groups.slice(from).flat()]) <= budgetBytes;

  // Widen backwards while it still fits — keep as much recent history as we can.
  while (start > firstDroppable && fits(start - 1, hasAnchor)) start -= 1;

  let keepAnchor = hasAnchor;
  if (keepAnchor && !fits(start, true)) {
    // A single oversized opening directive must not starve the recent turns.
    keepAnchor = false;
  }

  const tail = groups.slice(start).flat();
  const droppedTurns = start - firstDroppable + (keepAnchor ? 0 : firstDroppable);
  const messages: ConversationMessage[] = [
    ...(keepAnchor ? anchor : []),
    ...(droppedTurns > 0 ? [bridge] : []),
    ...tail,
  ];
  // Guarantee 1 — the anchor may have been dropped and the tail starts at an
  // assistant message, so the bridge is what restores the user-first shape.
  if (messages.length > 0 && messages[0].role !== 'user') messages.unshift(bridge);

  return {
    messages,
    droppedTurns,
    bytesBefore,
    bytesAfter: byteLength(messages),
    trimmed: true,
  };
}

/**
 * Serialize a session once and check it against the READ budget.
 *
 * Callers MUST NOT write when this returns `ok: false` — that is the whole
 * point. Serializing here (rather than at each writer) also means the bytes
 * that were measured are exactly the bytes that get written.
 */
export function serializeSessionBounded(
  session: unknown,
): { ok: true; content: string; bytes: number } | { ok: false; bytes: number; limit: number } {
  const content = JSON.stringify(session, null, 2);
  const bytes = Buffer.byteLength(content, 'utf-8');
  if (bytes > SESSION_MAX_BYTES) return { ok: false, bytes, limit: SESSION_MAX_BYTES };
  return { ok: true, content, bytes };
}

/**
 * Shed the recoverable parts of an over-budget session, in a fixed order, until
 * it fits. Compaction before failure — the audit's own ordering.
 *
 * The resume core (`taskQueue`, `currentTask`, `completedTasks`, `interruption`,
 * `jobId`) is NEVER shed: dropping it would turn an availability finding into
 * data loss, which is exactly the "tasks disappear from the Kanban" class the
 * cleanup manager already guards against.
 */
export function shedToFit(
  session: any,
  opts?: { keepSnapshots?: number },
): { ok: true; content: string; bytes: number; shed: string[] } | { ok: false; bytes: number; limit: number; shed: string[] } {
  const shed: string[] = [];
  let attempt = serializeSessionBounded(session);
  if (attempt.ok) return { ...attempt, shed };

  // (a) Historical kanban snapshots — the biggest blob and the least
  //     load-bearing (a UI-restore convenience with a live-state fallback).
  const keep = opts?.keepSnapshots ?? 3;
  if (Array.isArray(session.runs) && session.runs.length > keep) {
    let cleared = 0;
    for (let i = 0; i < session.runs.length - keep; i++) {
      if (session.runs[i]?.kanbanSnapshot) {
        session.runs[i] = { ...session.runs[i], kanbanSnapshot: null };
        cleared++;
      }
    }
    if (cleared > 0) {
      shed.push(`kanbanSnapshot×${cleared}`);
      attempt = serializeSessionBounded(session);
      if (attempt.ok) return { ...attempt, shed };
    }
  }

  // (b) Conversation channels — whole-turn trim, oldest first.
  const conversations = session.state?.conversations;
  if (conversations && typeof conversations === 'object') {
    for (const key of Object.keys(conversations)) {
      const channel = conversations[key];
      if (!Array.isArray(channel) || channel.length === 0) continue;
      const trim = trimConversationToByteBudget(channel);
      if (!trim.trimmed) continue;
      conversations[key] = trim.messages;
      shed.push(`conversations.${key}(-${trim.droppedTurns} turns)`);
    }
    attempt = serializeSessionBounded(session);
    if (attempt.ok) return { ...attempt, shed };
  }

  // (c) Append-only diagnostic histories — newest entries carry the signal.
  for (const field of ['completedTasksDetails', 'previousAttempts', 'enforcementHistory'] as const) {
    const list = session.state?.[field];
    if (!Array.isArray(list) || list.length <= 10) continue;
    session.state[field] = list.slice(-10);
    shed.push(`${field}(-${list.length - 10})`);
    attempt = serializeSessionBounded(session);
    if (attempt.ok) return { ...attempt, shed };
  }

  return { ok: false, bytes: attempt.bytes, limit: attempt.limit, shed };
}

/**
 * THE session-JSON write seam. Every writer — the adapter's `save()` and the
 * API-side helpers that build a session object and write it directly — goes
 * through here, so the budget is a property of the FILE FORMAT rather than of
 * one code path.
 *
 * That distinction is the whole lesson of this finding: the previous round put
 * its bound on the representative caller and left the others on the raw shape,
 * and no test failed. Sheds before refusing; refuses without touching the
 * previous valid file.
 */
export async function writeSessionBounded(
  sessionPath: string,
  session: unknown,
  opts?: { expect?: SessionWriteGuard },
): Promise<void> {
  if (opts?.expect) await assertUnchanged(sessionPath, opts.expect);
  const budgeted = shedToFit(session as any);
  if (!budgeted.ok) {
    throw new SessionWriteTooLargeError(sessionPath, budgeted.bytes, budgeted.limit);
  }
  if (budgeted.shed.length > 0) {
    console.warn(
      `🗜️  [Session] Shed to fit the ${SESSION_MAX_BYTES}-byte budget: ${sessionPath} — ${budgeted.shed.join(', ')}`,
    );
  }
  await atomicWriteFile(sessionPath, budgeted.content);
}

/**
 * Snapshot of the bytes a read-modify-write started from.
 *
 * The per-job `FileMutex` in the session adapter lives on the ADAPTER INSTANCE,
 * and adapters are constructed per request / per job run — with the job runner
 * in its own child process. So it serializes writers inside one job run and
 * nothing else: a worker sealing a turn and an API-side finalize / delete /
 * dismiss touching the same file are never ordered against each other, on any
 * pod. The budget above makes that pre-existing race matter more (a stale
 * writer re-serializing its own untrimmed copy would undo a trim), so the
 * writers that read-modify-write pass a guard and get a typed conflict instead
 * of a silent clobber.
 *
 * A content hash rather than a version field: `SessionSchema` is a plain
 * `z.object` (unknown top-level keys are stripped) and the universal seal
 * replaces `session.state` wholesale, so no persisted counter survives.
 */
export interface SessionWriteGuard {
  size: number;
  sha256: string;
}

export class SessionWriteConflictError extends Error {
  readonly code = 'SESSION_WRITE_CONFLICT' as const;
  constructor(readonly sessionPath: string) {
    super(`Session changed under a read-modify-write: ${sessionPath}`);
  }
}

/** Guard for text just read from `sessionPath` (null = the file was absent). */
export function sessionWriteGuardOf(text: string | null): SessionWriteGuard {
  const buf = Buffer.from(text ?? '', 'utf-8');
  return { size: text === null ? -1 : buf.byteLength, sha256: createHash('sha256').update(buf).digest('hex') };
}

async function assertUnchanged(sessionPath: string, expect: SessionWriteGuard): Promise<void> {
  // Through the bounded seam, not a raw read: this re-reads the very file the
  // budget exists for, so a plain readFile here would reintroduce the sink
  // inside the guard meant to protect it.
  const current = await readSessionTextContained(sessionPath);
  const now = sessionWriteGuardOf(current);
  if (now.size !== expect.size || now.sha256 !== expect.sha256) {
    throw new SessionWriteConflictError(sessionPath);
  }
}
