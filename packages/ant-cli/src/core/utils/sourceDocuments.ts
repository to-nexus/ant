/**
 * Source Document Combining Utilities
 *
 * Common functions for combining source documents from `plan/`.
 * Used by both design and code jobs to build a unified spec (prdSpec)
 * from all source files.
 *
 * Principle: All files in `plan/` are combined into a single spec.
 * Technology-independent and technology-specific content may coexist.
 * If technology-specific content is present, it represents a deliberate decision.
 */

import { generateFileOutline } from './fileOutline';
import type { ResolvedArtifact } from '@ant/shared';

/**
 * Filenames that own the `gen-plan` SSOT role across the two domains.
 * Both prd.md (service) and gdd.md (game) are sorted to the front of any
 * source-document listing so design and code prompts see the canonical
 * plan document first regardless of which domain authored it.
 */
const PLAN_FILE_NAMES = new Set(['prd.md', 'gdd.md']);

/**
 * Sort comparator that pulls plan-job canonical filenames (prd.md /
 * gdd.md) to the front of source-document listings, then falls back to
 * locale-aware alphabetic order. The two plan filenames are treated as
 * equal-priority so a workspace with one or the other (or both, in
 * legacy migrated cases) gets a stable ordering.
 */
function comparePlanFirst(a: string, b: string): number {
  const aIsPlan = PLAN_FILE_NAMES.has(a);
  const bIsPlan = PLAN_FILE_NAMES.has(b);
  if (aIsPlan && !bIsPlan) return -1;
  if (!aIsPlan && bIsPlan) return 1;
  if (aIsPlan && bIsPlan) {
    // Stable inside the plan group: prd.md before gdd.md alphabetically
    // anyway, but make the intent explicit.
    return a === 'prd.md' ? -1 : b === 'prd.md' ? 1 : 0;
  }
  return a.localeCompare(b);
}

/**
 * Find the canonical plan-job filename (prd.md or gdd.md) in a list of
 * candidate filenames. Prefer `prd.md` when both are present (legacy
 * migration safety: a workspace that authored prd.md before the gdd.md
 * split keeps prd.md as authoritative).
 */
function findPlanFile(filenames: string[]): string | undefined {
  if (filenames.includes('prd.md')) return 'prd.md';
  if (filenames.includes('gdd.md')) return 'gdd.md';
  return undefined;
}

/**
 * Build formatted source documents string for a specific task.
 *
 * @param sourceFiles - Files assigned to this task (1 or more).
 *                      undefined/empty = inject all (fallback).
 * @param sourceDocuments - All source files from `plan/` (filename -> content).
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

  const sorted = [...filesToInclude].sort(comparePlanFirst);

  return sorted
    .map(f => `--- ${f} ---\n\n${sourceDocuments[f]}`)
    .join('\n\n');
}

/**
 * Build full source documents string (all files).
 * Convenience wrapper that combines all source documents without filtering.
 */
export function buildAllSourceDocs(
  sourceDocuments?: Record<string, string>
): string {
  return buildSourceDocsForTask(undefined, sourceDocuments);
}

/**
 * Build budget-constrained source documents string.
 * Used by detect/decompose phases where full content may exceed the 200K token API limit.
 *
 * Strategy:
 *   1. If total content fits within budget, return all docs in full (no truncation)
 *   2. prd.md included in full (highest priority for classification)
 *   3. Two-pass redistribution: small files use only what they need,
 *      surplus budget is redistributed to larger files
 *
 * @param sourceDocuments - All source files (filename -> content)
 * @param maxChars - Character budget. Default 350K is safe for Korean-heavy content
 *                   where the actual ratio is ~2.0 chars/token (not the 3.5 used in estimates).
 *                   350K chars / 2.0 = 175K tokens → leaves ~25K tokens for template overhead.
 */
export function buildCondensedSourceDocs(
  sourceDocuments?: Record<string, string>,
  maxChars: number = 350_000
): string {
  if (!sourceDocuments || Object.keys(sourceDocuments).length === 0) return '';

  const HEADER_OVERHEAD = 20;
  const SEPARATOR_OVERHEAD = 4;

  const allFiles = Object.keys(sourceDocuments).sort(comparePlanFirst);

  const totalContentSize = allFiles.reduce((sum, f) => {
    return sum + sourceDocuments[f].length + HEADER_OVERHEAD + SEPARATOR_OVERHEAD;
  }, 0);

  if (totalContentSize <= maxChars) {
    return allFiles
      .map(f => `--- ${f} ---\n\n${sourceDocuments[f]}`)
      .join('\n\n');
  }

  // The plan document (prd.md for service, gdd.md for game) is the
  // highest-priority context for downstream classification and design.
  // Always include it in full; truncation distributes across other
  // files only.
  const prdKey = findPlanFile(allFiles);
  const otherFiles = prdKey ? allFiles.filter(f => f !== prdKey) : allFiles;

  let usedChars = 0;
  const parts: string[] = [];

  if (prdKey) {
    const prdContent = sourceDocuments[prdKey];
    const prdBlock = `--- ${prdKey} ---\n\n${prdContent}`;
    parts.push(prdBlock);
    usedChars += prdBlock.length + SEPARATOR_OVERHEAD;
  }

  if (otherFiles.length === 0) {
    return parts.join('\n\n');
  }

  const remainingBudget = maxChars - usedChars;
  if (remainingBudget <= 0) {
    return parts.join('\n\n');
  }

  const fileSizes = otherFiles.map(f => ({
    name: f,
    content: sourceDocuments[f],
    size: sourceDocuments[f].length,
  }));

  const allocations = redistributeBudget(fileSizes, remainingBudget, HEADER_OVERHEAD + SEPARATOR_OVERHEAD);

  for (const { name, content, budget } of allocations) {
    const header = `--- ${name} ---\n\n`;
    if (content.length <= budget) {
      parts.push(header + content);
    } else {
      const truncated = content.slice(0, budget);
      const lastNewline = truncated.lastIndexOf('\n');
      const cleanCut = lastNewline > budget * 0.5 ? truncated.slice(0, lastNewline) : truncated;
      const omitted = content.length - cleanCut.length;
      parts.push(header + cleanCut + `\n\n[... truncated (${omitted.toLocaleString()} chars omitted)]`);
    }
  }

  return parts.join('\n\n');
}

/**
 * Two-pass budget redistribution: small files take only what they need,
 * surplus flows to larger files that need more space.
 */
function redistributeBudget(
  files: { name: string; content: string; size: number }[],
  totalBudget: number,
  perFileOverhead: number
): { name: string; content: string; budget: number }[] {
  let remaining = totalBudget;
  const results: { name: string; content: string; budget: number }[] = [];
  const pending = [...files];

  while (pending.length > 0) {
    const perDocBudget = Math.floor(remaining / pending.length) - perFileOverhead;
    const nextRound: typeof pending = [];
    let roundUsed = 0;

    for (const file of pending) {
      if (file.size <= perDocBudget) {
        results.push({ name: file.name, content: file.content, budget: file.size });
        roundUsed += file.size + perFileOverhead;
      } else {
        nextRound.push(file);
      }
    }

    if (nextRound.length === pending.length) {
      for (const file of nextRound) {
        const budget = Math.floor(remaining / nextRound.length) - perFileOverhead;
        results.push({ name: file.name, content: file.content, budget: Math.max(0, budget) });
        remaining -= budget + perFileOverhead;
      }
      break;
    }

    remaining -= roundUsed;
    pending.length = 0;
    pending.push(...nextRound);
  }

  return results;
}

/**
 * Build a compact file index for large source document sets.
 * Contains filename, size, and a short preview — enough for LLM to decide which files to read.
 */
export function buildSourceFileIndex(
  sourceDocuments: Record<string, string>,
  previewLines: number = 8,
  options?: { includeLineNumbers?: boolean },
): string {
  if (!sourceDocuments || Object.keys(sourceDocuments).length === 0) return '';

  const includeLineNumbers = options?.includeLineNumbers ?? false;

  const sorted = Object.keys(sourceDocuments).sort(comparePlanFirst);

  const totalChars = Object.values(sourceDocuments).reduce((s, c) => s + c.length, 0);

  const lines = [
    `**${sorted.length} source documents** (${totalChars.toLocaleString()} chars total)`,
    '',
    '| # | Filename | Size | Preview |',
    '|---|----------|------|---------|',
  ];

  for (let i = 0; i < sorted.length; i++) {
    const name = sorted[i];
    const content = sourceDocuments[name];
    const totalLines = content.split('\n').length;
    const preview = content
      .split('\n')
      .filter(l => l.trim().length > 0)
      .slice(0, previewLines)
      .join(' ')
      .slice(0, 200)
      .replace(/\|/g, '\\|');
    const sizeStr = includeLineNumbers
      ? `${content.length.toLocaleString()} chars (${totalLines} lines)`
      : `${content.length.toLocaleString()} chars`;
    lines.push(`| ${i + 1} | \`${name}\` | ${sizeStr} | ${preview}... |`);

    if (includeLineNumbers) {
      const outline = generateFileOutline(content, name);
      if (outline) {
        const compactOutline = outline
          .split('\n')
          .slice(0, 30)
          .join(' / ')
          .replace(/\|/g, '\\|')
          .slice(0, 800);
        lines.push(`|   |  |  | ${compactOutline} |`);
      }
    } else {
      const headings = content
        .split('\n')
        .filter(l => /^#{1,3} /.test(l))
        .map(l => l.trim())
        .join(' / ');
      if (headings) {
        lines.push(`|   |  |  | Outline: ${headings.slice(0, 500)} |`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Convert source documents to ResolvedArtifact[] for RAC-aware nodes.
 * Each file becomes a separate ResolvedArtifact with the given role.
 * Existing functions remain for non-RAC paths (detect, decompose).
 *
 * @param sourceDocuments - Source files from `plan/` (filename -> content)
 * @param role - Role to assign: 'ref' for implementation sources, 'context' for background
 */
export function buildSourceDocsAsResolved(
  sourceDocuments?: Record<string, string>,
  role: 'ref' | 'context' = 'context',
): ResolvedArtifact[] {
  if (!sourceDocuments || Object.keys(sourceDocuments).length === 0) return [];

  const sorted = Object.keys(sourceDocuments).sort(comparePlanFirst);

  return sorted.map(filename => ({
    path: filename,
    content: sourceDocuments[filename],
    role,
    label: filename,
  }));
}

/**
 * Compute total character size of source documents.
 */
export function getSourceDocsSize(sourceDocuments?: Record<string, string>): number {
  if (!sourceDocuments) return 0;
  return Object.values(sourceDocuments).reduce((sum, c) => sum + c.length, 0);
}

/**
 * Handle read_source_doc tool call by reading from in-memory source documents.
 * Supports optional startLine/endLine for selective reading of large documents.
 */
export function handleReadSourceFile(
  filename: string,
  sourceDocuments: Record<string, string>,
  startLine?: number,
  endLine?: number,
): string {
  const content = sourceDocuments[filename];
  if (!content) {
    const available = Object.keys(sourceDocuments).join(', ');
    return `Error: File "${filename}" not found. Available: ${available}`;
  }

  const lines = content.split('\n');
  const totalLines = lines.length;

  if (startLine || endLine) {
    const start = Math.max(1, startLine || 1);
    const end = Math.min(totalLines, endLine || totalLines);
    const slice = lines.slice(start - 1, end).join('\n');
    return `[Lines ${start}-${end} of ${totalLines}]\n\n${slice}`;
  }

  return `[Total: ${totalLines} lines]\n\n${content}`;
}
