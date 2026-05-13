/**
 * Parser interface for streaming LLM responses
 * 
 * Different parsers can be implemented for different prompt formats:
 * - FileMarkerParser: Handles === FILE: === and === EDIT: === markers (current)
 * - XMLParser: Handles <file>, <edit> XML tags (future)
 * - JSONStructuredParser: Handles JSON mode output (future)
 */

import { LLMStreamEvent } from '../../ports/llm';
import { ParsedAction } from '../types';
import { StreamState } from '../state/StreamState';

export interface IStreamParser {
  /**
   * Parse streaming event and produce zero or more actions
   * 
   * @param event - Raw LLM stream event
   * @param state - Current stream state (for stateful parsing)
   * @returns Array of parsed actions (can be empty during accumulation phase)
   */
  parse(event: LLMStreamEvent, state: StreamState): ParsedAction[];
  
  /**
   * Finalize parsing and flush any remaining buffered content
   * 
   * @returns Array of final parsed actions from buffer
   */
  finalize(): ParsedAction[];
  
  /**
   * Reset parser state (called at start of new stream)
   */
  reset(): void;

  /**
   * Snapshot of an in-flight file/append block, if the stream cut off
   * before the closing tag arrived. Returns `null` when no file block is
   * open. Called by the execute node when the LLM reports
   * `stopReason === 'max_tokens'` so it can inform the LLM in the next
   * round where to resume via `<append>`.
   *
   * Implementations MAY return a `null`-only stub (e.g. the file-marker
   * parser has no `<file>` tag concept).
   */
  getOpenFileContext?(): { kind: 'file' | 'append'; path: string; tailContent: string } | null;
}

