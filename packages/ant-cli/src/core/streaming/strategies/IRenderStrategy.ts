/**
 * Render strategy interface for processing parsed actions
 * 
 * Different strategies can be implemented for different job types,
 * but CommonRenderStrategy should cover 99% of cases.
 */

import { ParsedAction } from '../types';
import { FileRegistry } from '../state/FileRegistry';

export interface IRenderStrategy {
  /**
   * Render a parsed action to the UI
   * 
   * @param action - Parsed action from parser
   * @param registry - File registry for duplicate detection
   */
  render(action: ParsedAction, registry: FileRegistry): Promise<void>;
  
  /**
   * Finalize rendering (called after stream completes)
   * Used to cleanup incomplete operations
   */
  finalize(): Promise<void>;
}

