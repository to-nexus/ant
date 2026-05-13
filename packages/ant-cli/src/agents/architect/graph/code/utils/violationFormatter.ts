/**
 * Violation Formatting Utility
 * 
 * Formats structured violations into human-readable text for LLM prompts.
 * Extracted from enforce.ts to be reusable across nodes.
 */

import { Violation } from "../state";

/**
 * Format violations into human-readable text
 */
export function formatViolations(violations: Violation[]): string {
  if (!violations || violations.length === 0) {
    return '';
  }
  
  return violations.map((v, idx) => {
    const parts = [
      `${idx + 1}. ${v.type}`,
      `   Message: ${v.message}`
    ];

    if (v.file) parts.push(`   File: ${v.file}`);
    if (v.suggestedFix) parts.push(`   💡 Suggested Fix: ${v.suggestedFix}`);
    if (v.isRetryable !== undefined) {
      parts.push(`   ♻️  Retryable: ${v.isRetryable ? 'YES' : 'NO (needs task decomposition)'}`);
    }

    return parts.join('\n');
  }).join('\n\n');
}

/**
 * Extract file paths from violations
 */
export function extractFilesFromViolations(violations?: Violation[]): string[] {
  if (!violations || violations.length === 0) {
    return [];
  }
  
  return violations
    .filter(v => v.file && (
      v.type === 'file_operation_failed' ||
      v.message.includes('Search block not found') ||
      v.message.includes('Duplicate edit')
    ))
    .map(v => v.file as string)
    .filter((file, idx, arr) => arr.indexOf(file) === idx); // deduplicate
}

