/**
 * Common utilities for tool handlers
 */

import { ArchitectGraphState } from '../../../state';
import { FileSystemPort } from '../../../../../../../core/ports/filesystem';

/**
 * Validate and get FileSystemPort
 * Throws error with proper logging if not available
 */
export function getFileSystem(state: ArchitectGraphState, toolName: string): FileSystemPort {
  const fileSystem = state.deps?.fileSystem;
  
  if (!fileSystem) {
    const errorMsg = `FileSystemPort not available for ${toolName}`;
    console.error(`[${toolName}] ❌ ${errorMsg}`);
    throw new Error(errorMsg);
  }
  
  return fileSystem;
}

/**
 * Wrap tool execution with error handling and logging
 */
export async function withErrorHandling<T>(
  toolName: string,
  operation: () => Promise<T>,
  context?: Record<string, any>
): Promise<T> {
  try {
    if (context) {
      console.log(`[${toolName}] Executing with:`, context);
    }
    
    const result = await operation();
    console.log(`[${toolName}] ✅ Success`);
    return result;
    
  } catch (error: any) {
    console.error(`[${toolName}] ❌ Error:`, error.message);
    if (context) {
      console.error(`[${toolName}] Context:`, context);
    }
    throw error;  // Re-throw - will be stored in toolResults.error
  }
}

/**
 * Log file operation
 */
export function logFileOperation(
  toolName: string,
  operation: string,
  path: string,
  details?: Record<string, any>
): void {
  const detailsStr = details ? ` (${JSON.stringify(details)})` : '';
  console.log(`[${toolName}] ${operation}: ${path}${detailsStr}`);
}

