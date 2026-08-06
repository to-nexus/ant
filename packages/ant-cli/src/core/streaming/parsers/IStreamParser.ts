/**
 * Parser interface for streaming LLM responses
 *
 * Parses non-file canonical tags (thinking / plan / tasks / clarify /
 * references / learn_command / function_calls suppression) out of the raw
 * text stream. File authoring is tool-call-only (`create_file` /
 * `append_file` / `edit_file`, live-rendered by ToolFileStreamer) — the
 * parser has no file-tag concept.
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
}
