/**
 * Source Document Selection for Design Job
 *
 * Mirrors the code job's designSelector.ts pattern:
 *   task.packages + buildDesignDocForTask  ↔  task.sourceFiles + buildSourceDocsForTask
 *
 * - task.sourceFiles set: only listed files injected (with filename headers)
 * - task.sourceFiles NOT set: all files injected (fallback)
 */

/**
 * Build formatted source documents string for a design task.
 *
 * @param sourceFiles - Files assigned to this task by decompose (1 or more).
 *                      undefined/empty = inject all (fallback).
 * @param sourceDocuments - All source files from inputs/sources/ (filename -> content).
 */
export function buildSourceDocsForTask(
  sourceFiles: string[] | undefined,
  sourceDocuments?: Record<string, string>
): string {
  if (!sourceDocuments || Object.keys(sourceDocuments).length === 0) return '';

  const filesToInclude = sourceFiles && sourceFiles.length > 0
    ? sourceFiles.filter(f => sourceDocuments[f])
    : Object.keys(sourceDocuments);

  if (filesToInclude.length === 0) return '';

  const sorted = [...filesToInclude].sort((a, b) => {
    if (a === 'prd.md') return -1;
    if (b === 'prd.md') return 1;
    return a.localeCompare(b);
  });

  return sorted
    .map(f => `--- ${f} ---\n\n${sourceDocuments[f]}`)
    .join('\n\n');
}

/**
 * Build full source documents string (all files). Used by decompose/detectEnvironment
 * which always need the complete picture.
 */
export function buildAllSourceDocs(
  sourceDocuments?: Record<string, string>
): string {
  return buildSourceDocsForTask(undefined, sourceDocuments);
}
