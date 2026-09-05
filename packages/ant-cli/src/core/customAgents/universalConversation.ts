/**
 * Universal session conversation channels — WHICH array on disk is "the
 * conversation" for a turn.
 *
 * A pipeline RUN is one business case. Every step of a run dispatches the same
 * (agent, job) definition, so every step of every run used to append to the one
 * `session:main` array: a new case's intake step read a PREVIOUS case's answers
 * as its own memory and skipped the questions it should have asked (observed
 * 2026-09-04 — a run adopted another case's effective date, statute id and
 * terms key without asking). The cross-run channels this design does declare
 * are explicit: the `{{run.prevSuccess.*}}` watermark and artifacts + context
 * pins. Conversation memory is not one of them.
 *
 * So the STORED channel is keyed by the run (`session:run:{runId}`), while the
 * graph keeps working on `session:main` in memory — nodes stay channel-blind.
 * The runner maps the stored channel in at restore, the seal maps it back out
 * and carries the interactive channel through untouched, and the seal stamps
 * `conversationChannel` so every out-of-process reader (the pipeline
 * coordinator's answer capture, the run-history input summary) reads the array
 * that turn actually wrote.
 */

import { CONV_KEYS } from '../../agents/common/graph/conversations';

export const UNIVERSAL_RUN_CHANNEL_PREFIX = 'session:run:';

/** The stored channel for a turn: run-scoped when a pipeline run dispatched it. */
export function universalConversationChannel(pipelineRunId?: string): string {
  return pipelineRunId ? `${UNIVERSAL_RUN_CHANNEL_PREFIX}${pipelineRunId}` : CONV_KEYS.SESSION_MAIN;
}

/** The conversation a sealed session state holds — legacy seals have no stamp. */
export function selectSealedConversation<T>(state: {
  conversationChannel?: unknown;
  conversations?: Record<string, T[]>;
} | null | undefined): T[] {
  const channel = typeof state?.conversationChannel === 'string' ? state.conversationChannel : CONV_KEYS.SESSION_MAIN;
  const conv = state?.conversations?.[channel] ?? state?.conversations?.[CONV_KEYS.SESSION_MAIN];
  return Array.isArray(conv) ? conv : [];
}

function lastTimestamp<T extends { timestamp?: string }>(messages: T[] | undefined): string {
  for (let i = (messages?.length ?? 0) - 1; i >= 0; i -= 1) {
    const ts = messages?.[i]?.timestamp;
    if (typeof ts === 'string') return ts;
  }
  return '';
}

/**
 * The channels a seal carries UNCHANGED beside the one it writes (the session
 * state is replaced wholesale, so anything omitted here is deleted from disk).
 *
 * The interactive channel always survives a run's seal. Run channels do not
 * accumulate: a run's memory is disposable once the run is over — the audit
 * record is the run JSONL and `runs[]`. The one exception is the asymmetric
 * case, an interactive turn sealing while a run channel exists: it keeps the
 * newest one, because a run that is still executing must not lose its memory
 * to a turn from the other rail.
 */
export function carriedSealChannels<T extends { timestamp?: string }>(
  conversations: Record<string, T[]> | undefined,
  activeChannel: string,
): Record<string, T[]> {
  if (!conversations) return {};
  const candidates = Object.keys(conversations).filter(
    (k) => k.startsWith('session:') && k !== activeChannel && (conversations[k]?.length ?? 0) > 0,
  );
  const carried: Record<string, T[]> = {};
  if (candidates.includes(CONV_KEYS.SESSION_MAIN)) carried[CONV_KEYS.SESSION_MAIN] = conversations[CONV_KEYS.SESSION_MAIN];
  if (!activeChannel.startsWith(UNIVERSAL_RUN_CHANNEL_PREFIX)) {
    const newestRun = candidates
      .filter((k) => k.startsWith(UNIVERSAL_RUN_CHANNEL_PREFIX))
      .sort((a, b) => lastTimestamp(conversations[b]).localeCompare(lastTimestamp(conversations[a])))[0];
    if (newestRun) carried[newestRun] = conversations[newestRun];
  }
  return carried;
}
