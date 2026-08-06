/**
 * Render strategy interface for processing parsed actions
 *
 * Different strategies can be implemented for different job types,
 * but CommonRenderStrategy should cover 99% of cases.
 */

import { ParsedAction } from '../types';

export interface IRenderStrategy {
  /**
   * Render a parsed action to the UI
   *
   * @param action - Parsed action from parser
   */
  render(action: ParsedAction): Promise<void>;

  /**
   * Finalize rendering (called after stream completes)
   * Used to cleanup incomplete operations
   *
   * @param hasToolCalls - If true, keeps message open for tool execution
   */
  finalize(hasToolCalls?: boolean): Promise<void>;
}
