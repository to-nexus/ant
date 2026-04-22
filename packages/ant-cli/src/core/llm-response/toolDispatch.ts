/**
 * Tool Dispatch SSOT
 *
 * Single source of truth for how a tool name maps to a chat content card
 * during LLM streaming or when a trace.jsonl `tool_call` line is replayed
 * into `ChatMessage` content.
 *
 * Two knobs:
 *
 * 1. `TOOLS_WITH_DEDICATED_STATUS` — tools whose handlers emit their own
 *    `ChatStatusType` pair (e.g. `reading`/`read`, `listing_files`/
 *    `listed_files`, `command`, ...). Live streaming code must NOT also
 *    publish a generic `tool_action` card for these tools; the handler
 *    already does it. Trace replay must NOT materialise a `tool_action`
 *    either — it instead rematerialises the dedicated status card from
 *    the tool_call args.
 *
 * 2. `dispatchToolCallToContent(toolName, args, error?)` — returns the
 *    `MessageContent` that should be emitted for a given tool_call
 *    trace line. `null` means "skip this tool_call" (either because
 *    another trace line owns the card — `run_command` line for
 *    `run_command`, `file_write` line for file ops — or because the
 *    dedicated-status pair will be rendered via this helper's
 *    `reading`/`listed_files`/... branches below).
 *
 * The live LLMEventHandler path (`core/llm-response/LLMEventHandler.ts`
 * and `periphery/.../ChatService/LLMEventHandler.ts`) imports
 * `TOOLS_WITH_DEDICATED_STATUS` to gate the generic `tool_action` fallback,
 * and `TraceToChatMessages` imports `dispatchToolCallToContent` to replay
 * persisted tool_calls.
 *
 * Keeping both in one file prevents the drift we hit previously where
 * three separate Set literals had to be kept in sync manually.
 */

import type { MessageContent } from '../chat/types';
import { generateChatStatusContent } from './generateStatusContent';

/**
 * Tools whose handlers emit dedicated `ChatStatusType` progress + result
 * cards. Generic `tool_action` fallback MUST be skipped for these.
 */
export const TOOLS_WITH_DEDICATED_STATUS: ReadonlySet<string> = new Set([
  'read_file',             // → reading / read (WorkingCard)
  'list_files',            // → listing_files / listed_files (WorkingCard)
  'search_code',           // → searching_code / searched_code (WorkingCard)
  'run_command',           // → command_running / command_streaming / command (TerminalCard)
  'search_reference_code', // → searching_reference / searched_reference (WorkingCard)
]);

/**
 * Tools that mutate files. Their final card is emitted by the companion
 * `file_write` trace line (which carries content + diff), so a tool_call
 * replay should skip unless an error is attached.
 */
const FILE_MUTATING_TOOLS: ReadonlySet<string> = new Set([
  'edit_file',
  'delete_file',
  // shadow tools — LLM incorrectly uses tool instead of <file> XML
  'file',
  'write_file',
  'create_file',
]);

function fileOpForTool(
  toolName: string,
): 'create' | 'update' | 'delete' | null {
  if (toolName === 'delete_file') return 'delete';
  if (toolName === 'edit_file') return 'update';
  if (toolName === 'file' || toolName === 'write_file' || toolName === 'create_file') return 'create';
  return null;
}

/**
 * Truncate long string values in input args so replayed tool_action cards
 * don't overflow the UI. Mirrors the live `handleGenericToolUse` compacting.
 */
function summariseArgs(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object') return {};
  const src = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(src)) {
    if (typeof value === 'string' && value.length > 100) {
      out[key] = `(${value.length} chars)`;
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Decide which `MessageContent` (if any) to render for a persisted
 * `tool_call` trace line during chat-history rebuild.
 *
 * Rules:
 * - File-mutating tools (`edit_file`, `file`, `write_file`, `create_file`,
 *   `delete_file`) — SKIP unless `error` is set. The matching `file_write`
 *   line carries the authoritative content + diff for the FileCard. When
 *   `error` is set the tool_call itself becomes the failure card.
 * - `run_command` — SKIP. The companion `run_command` trace line owns the
 *   TerminalCard.
 * - Dedicated-status tools (`read_file`, `list_files`, `search_code`,
 *   `search_reference_code`) — materialise the "result" side of the
 *   status pair (`read`, `listed_files`, ...) from the tool_call args.
 *   These tools run synchronously inside the tool node so replayed history
 *   always represents a completed state.
 * - `mkdir` — render a `tool_action` card with the folder icon (mirrors
 *   the live path's custom copy).
 * - Everything else — generic `tool_action` fallback.
 */
export function dispatchToolCallToContent(
  toolName: string,
  args: unknown,
  error?: string,
  timestamp?: string,
): MessageContent | null {
  const ts = timestamp ?? new Date().toISOString();
  const argObj = (args && typeof args === 'object') ? (args as Record<string, unknown>) : {};

  // File-mutating tools — companion file_write owns the card, unless errored.
  const fileOp = fileOpForTool(toolName);
  if (fileOp) {
    if (!error) return null;
    const filePath = typeof argObj.path === 'string' ? argObj.path : '';
    const type: MessageContent['type'] =
      fileOp === 'create' ? 'file_create_failed'
      : fileOp === 'delete' ? 'file_delete_failed'
      : 'file_edit_failed';
    return {
      type,
      content: '',
      metadata: {
        filePath,
        reason: error,
        timestamp: ts,
      },
    };
  }

  // run_command — companion run_command line owns the TerminalCard.
  if (toolName === 'run_command') {
    if (!error) return null;
    return {
      type: 'command',
      content: error,
      metadata: {
        command: typeof argObj.command === 'string' ? argObj.command : '',
        exitCode: -1,
        timestamp: ts,
      },
    };
  }

  // Dedicated-status tools — synthesize the "result" card.
  //
  // `content` MUST be the same label the live path displayed, so WorkingCard
  // (which uses `content` as its visible label) doesn't render as an empty
  // icon. The live path calls `generateChatStatusContent(statusType, md)`;
  // we call the same function here so replay matches broadcast byte-for-byte.
  //
  // NOTE: for post-migration data every dedicated-status tool also has a
  // companion `chat_status` line (emitted by the tool handler's
  // `showChatStatus('read'|'listed_files'|…)` call) which supersedes this
  // branch via the chat_status-first preference in TraceToChatMessages.
  // This branch remains authoritative only for legacy feature folders
  // whose chat log predates the SSOT collapse.
  if (toolName === 'read_file') {
    const filePath = typeof argObj.path === 'string' ? argObj.path : '';
    const metadata = { filePath, error: error ? true : undefined, timestamp: ts };
    return {
      type: 'read',
      content: generateChatStatusContent('read', metadata),
      metadata,
    };
  }
  if (toolName === 'list_files') {
    const directory = typeof argObj.directory === 'string' ? argObj.directory : '';
    const pattern = typeof argObj.pattern === 'string' ? argObj.pattern : undefined;
    const metadata = {
      directory,
      pattern,
      error: error ? true : undefined,
      timestamp: ts,
    };
    return {
      type: 'listed_files',
      content: generateChatStatusContent('listed_files', metadata),
      metadata,
    };
  }
  if (toolName === 'search_code') {
    const pattern = typeof argObj.pattern === 'string' ? argObj.pattern : '';
    const filePattern = typeof argObj.file_pattern === 'string' ? argObj.file_pattern : undefined;
    const metadata = {
      pattern,
      file_pattern: filePattern,
      error: error ? true : undefined,
      timestamp: ts,
    };
    return {
      type: 'searched_code',
      content: generateChatStatusContent('searched_code', metadata),
      metadata,
    };
  }
  if (toolName === 'search_reference_code') {
    const project = typeof argObj.project === 'string' ? argObj.project : 'reference project';
    const query = typeof argObj.query === 'string' ? argObj.query : '';
    const metadata = {
      project,
      query,
      error: error ? true : undefined,
      timestamp: ts,
    };
    return {
      type: 'searched_reference',
      content: generateChatStatusContent('searched_reference', metadata),
      metadata,
    };
  }

  // mkdir — tool_action with dedicated folder icon.
  if (toolName === 'mkdir') {
    const dirPath = typeof argObj.path === 'string' ? argObj.path : '';
    return {
      type: 'tool_action',
      content: error ? `mkdir failed: ${error}` : `Created directory: ${dirPath}`,
      metadata: {
        toolName: 'mkdir',
        actionIcon: error ? '⚠️' : '📁',
        filePath: dirPath,
        timestamp: ts,
      },
    };
  }

  // Generic fallback — tool_action with summarised args.
  if (error) {
    return {
      type: 'tool_action',
      content: `${toolName}: ${error}`,
      metadata: {
        toolName,
        actionIcon: '⚠️',
        timestamp: ts,
      },
    };
  }
  const summary = summariseArgs(argObj);
  const json = JSON.stringify(summary);
  const displayContent = json.length > 200
    ? `${toolName}: ${json.substring(0, 200)}...`
    : `${toolName}: ${json}`;
  return {
    type: 'tool_action',
    content: displayContent,
    metadata: {
      toolName,
      actionIcon: '🔧',
      timestamp: ts,
    },
  };
}
