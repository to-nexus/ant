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
}

