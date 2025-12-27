/**
 * Utility functions for runtime validation
 */

import { ArchitectGraphState } from "../../state";
import { RuntimeValidationResult } from "./types";

/**
 * Detect recent tool failures from command history
 */
export function detectRecentToolFailures(state: ArchitectGraphState): number {
  if (!state.commandHistory || state.commandHistory.length === 0) {
    return 0;
  }
  
  const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
  const recentFailures = state.commandHistory.filter(h => 
    !h.success && 
    h.timestamp > fiveMinutesAgo
  );
  
  return recentFailures.length;
}

/**
 * Format validation errors for display
 */
export function formatValidationErrors(result: RuntimeValidationResult): string[] {
  const lines: string[] = [];
  
  if (result.typeErrors && result.typeErrors.length > 0) {
    lines.push('📘 Type Errors:');
    result.typeErrors.slice(0, 5).forEach(err => lines.push(`  - ${err}`));
    if (result.typeErrors.length > 5) {
      lines.push(`  ... and ${result.typeErrors.length - 5} more`);
    }
    lines.push('');
  }
  
  if (result.lintErrors && result.lintErrors.length > 0) {
    lines.push('📋 Lint Errors (LOW PRIORITY - Fix after build/deps/types):');
    result.lintErrors.slice(0, 5).forEach(err => lines.push(`  - ${err}`));
    if (result.lintErrors.length > 5) {
      lines.push(`  ... and ${result.lintErrors.length - 5} more`);
    }
    lines.push('');
  }
  
  if (result.buildErrors && result.buildErrors.length > 0) {
    lines.push('🔨 Build Errors:');
    result.buildErrors.slice(0, 5).forEach(err => lines.push(`  - ${err}`));
    if (result.buildErrors.length > 5) {
      lines.push(`  ... and ${result.buildErrors.length - 5} more`);
    }
    lines.push('');
  }
  
  if (result.testErrors && result.testErrors.length > 0) {
    lines.push('🧪 Test Errors:');
    result.testErrors.forEach(err => lines.push(`  - ${err}`));
    lines.push('');
  }
  
  lines.push('⚠️  Please fix these errors and regenerate.');
  
  return lines;
}

