/**
 * Conversations — Unified conversation state for all agent graphs.
 *
 * All conversation data lives in a single `conversations: Record<string, ConversationMessage[]>`
 * field on graph state. Keys follow the `level:id` convention:
 *   - `session:*` — persisted across job runs (semantic history)
 *   - `node:*`    — ephemeral within a single job run (LLM tool-loop messages)
 *
 * Shallow-merge reducer: returning `{ conversations: { 'node:execute': [...] } }`
 * preserves all other keys in the record.
 */

import type { MessageContentBlock } from '../../../core/ports/llm';
import type { Boundary } from '@ant/shared';

// ─── Key convention ───

export type ConversationLevel = 'session' | 'node';
export type ConversationKey = `${ConversationLevel}:${string}`;

// ─── Unified message type ───

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | MessageContentBlock[];
  timestamp?: string;
  metadata?: {
    hasArtifact?: boolean;
    artifactPath?: string;
    mode?: string;
    savedAsset?: string;
    chapterSummary?: string;
    boundary?: Boundary;
    jobId?: string;
    taskCount?: number;
    filesWritten?: number;
  };
}

// ─── Key constants ───

export const CONV_KEYS = {
  SESSION_MAIN:  'session:main'  as ConversationKey,
  NODE_EXECUTE:  'node:execute'  as ConversationKey,
  NODE_PLAN:     'node:plan'     as ConversationKey,
  NODE_DOCGEN:   'node:docGen'   as ConversationKey,
  NODE_GENERATE: 'node:generate' as ConversationKey,
  NODE_AGENT:    'node:agent'    as ConversationKey,
  /**
   * Session-redesign `direct` ReAct loop history. Separate from NODE_EXECUTE
   * because direct has no currentTask lifecycle — the loop opens and closes
   * within a single node invocation, then routes to learn or back to decompose.
   * Retention: discarded at direct exit (next direct entry starts fresh; see
   * applyRetention with jobType='code' which always discards).
   */
  NODE_DIRECT:   'node:direct'   as ConversationKey,
} as const;

// ─── Type aliases for readability ───

export type Conversations = Record<string, ConversationMessage[]>;

// ─── Access helpers ───

export function getConv(convs: Conversations | undefined, key: ConversationKey): ConversationMessage[] {
  return convs?.[key] ?? [];
}

export function setConv(key: ConversationKey, entries: ConversationMessage[]): { conversations: Conversations } {
  return { conversations: { [key]: entries } };
}

// ─── Type guards ───

export function isSessionEntry(msg: ConversationMessage): msg is ConversationMessage & { content: string; timestamp: string } {
  return typeof msg.content === 'string' && !!msg.timestamp;
}

export function isNodeMessage(msg: ConversationMessage): msg is ConversationMessage & { content: string | MessageContentBlock[] } {
  return !msg.timestamp;
}

// ─── Reducer for LangGraph Annotation ───

export function conversationsReducer(prev: Conversations, next: Conversations): Conversations {
  return { ...prev, ...next };
}
