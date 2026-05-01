import type { Violation } from '../../../state';
import { formatViolations } from '../../../utils/violationFormatter';

/**
 * Compose `violationsText` from the current cycle alone. Prior-attempt
 * reasoning continuity lives in (a) the verification Session summary,
 * (b) the LLM's `read_file` lookups into `sessions/architect/code.json`.
 * MUST stay task-type-blind.
 */
export function composeViolationsText(
  violations: Violation[] | undefined,
): string | undefined {
  if (!violations?.length) return undefined;
  const parts: string[] = [formatViolations(violations)];
  const guidance = renderViolationGuidance(violations);
  if (guidance) parts.push(guidance);
  return parts.join('\n');
}

/**
 * Type-specific actionable guidance, keyed off `violations[0]?.type`.
 */
export function renderViolationGuidance(
  violations: Violation[],
): string | undefined {
  const errorType = violations[0]?.type;

  if (errorType === 'cross_worker_conflict') {
    const conflictFiles = violations
      .map(v => v.file)
      .filter(Boolean);
    const fileList = conflictFiles.map(f => `  - ${f}`).join('\n');

    return [
      '',
      '🚨 CROSS-WORKER FILE CONFLICT',
      '',
      'Another parallel task already created these files:',
      fileList,
      '',
      '⛔ DO NOT use <file> tag to overwrite these files directly.',
      '',
      '✅ REQUIRED (2 steps):',
      '1. Call read_file("path") to get the CURRENT content and version',
      '2. Then EITHER:',
      '   a. Use <file path="path"> with MERGED content (full rewrite)',
      '   b. Use edit_file tool to partially modify',
    ].join('\n');
  }

  if (errorType === 'file_operation_failed') {
    const searchBlockErrors = violations.filter(v =>
      v.message.includes('Search block not found') ||
      v.message.includes('Duplicate edit'),
    );
    if (searchBlockErrors.length === 0) return undefined;

    const files = searchBlockErrors
      .map(v => v.file)
      .filter(Boolean)
      .join(', ');

    return [
      '',
      `🚨 PREVIOUS ATTEMPT FAILED: ${searchBlockErrors.length} file edit error(s)`,
      '',
      `Files: ${files}`,
      '',
      'REASON: Search block mismatch (outdated content)',
      '',
      '✅ REQUIRED FIX (2 steps):',
      '1. Call read_file("path") to get CURRENT content',
      '2. Use EXACT old_str from read_file result in edit_file tool',
    ].join('\n');
  }

  return undefined;
}
