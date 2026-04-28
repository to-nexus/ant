/**
 * Content Compactor
 *
 * Unified utility for compacting large documents before prompt injection.
 * When content exceeds a character threshold, it is replaced with a
 * structural outline (line-numbered TOC) plus an instruction to use
 * read_file(path, startLine, endLine) for on-demand decompaction.
 *
 * Reuses generateFileOutline() from fileOutline.ts which already supports
 * JSON, Markdown, TypeScript, Go, and YAML outline extraction.
 *
 * Usage sites:
 *   - Spec doc (error task) — was condenseSpecDoc()
 *   - ui-assets.json injection
 *   - design document injection (via documents[])
 */

import * as path from 'path';
import { generateFileOutline } from './fileOutline';

export interface CompactOptions {
  /** Character-count threshold. Content at or below this is returned as-is. */
  threshold: number;
  /** Human-readable document label shown in the compacted header. */
  label: string;
  /**
   * File path for read_file instruction (e.g. "visual/ui/ant/ui-assets.json").
   * When omitted the compacted output omits the read_file hint.
   */
  filePath?: string;
  /**
   * Force a content type so the correct outline extractor is chosen.
   * 'auto' (default) infers from the label/filePath extension.
   */
  contentType?: 'json' | 'markdown' | 'auto';
  /** Tool name shown in the access hint. Defaults to "read_file". */
  toolHint?: string;
}

export interface CompactResult {
  content: string;
  wasCompacted: boolean;
  originalChars: number;
  compactedChars: number;
}

/**
 * Build a synthetic file path that causes generateFileOutline() to pick
 * the right extractor (JSON vs Markdown vs fallback).
 */
function resolveOutlinePath(
  label: string,
  filePath?: string,
  contentType?: string,
): string {
  if (contentType === 'json') return filePath || `${label}.json`;
  if (contentType === 'markdown') return filePath || `${label}.md`;

  // auto: try filePath extension first, then label extension
  if (filePath) {
    const ext = path.extname(filePath);
    if (ext) return filePath;
  }
  const ext = path.extname(label);
  if (ext) return label;

  // Fallback: treat as markdown (heading extraction is the safest default)
  return `${label}.md`;
}

/**
 * Ensure JSON content is pretty-printed so that extractJsonOutline()
 * can locate top-level keys on their own lines.
 */
function ensurePrettyJson(content: string): string {
  if (!content.startsWith('{') && !content.startsWith('[')) return content;
  const lineCount = content.split('\n').length;
  // Heuristic: if the entire JSON fits in very few lines relative to its
  // size, it is probably compact/minified.
  if (lineCount > content.length / 200) return content;
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

/**
 * Compact content that exceeds `threshold` characters into a structural
 * outline with line numbers and a read_file access hint.
 *
 * When the content is within budget it is returned unchanged.
 */
export function compactContent(
  content: string,
  options: CompactOptions,
): CompactResult {
  const {
    threshold,
    label,
    filePath,
    contentType = 'auto',
    toolHint = 'read_file',
  } = options;

  if (content.length <= threshold) {
    return {
      content,
      wasCompacted: false,
      originalChars: content.length,
      compactedChars: content.length,
    };
  }

  const resolvedType =
    contentType !== 'auto'
      ? contentType
      : detectContentType(label, filePath);

  const outlineInput =
    resolvedType === 'json' ? ensurePrettyJson(content) : content;

  const outlinePath = resolveOutlinePath(label, filePath, resolvedType);
  const outline = generateFileOutline(outlineInput, outlinePath);
  const lineCount = outlineInput.split('\n').length;

  const parts: string[] = [
    `# ${label} (${lineCount} lines, compacted)`,
    '',
    '> Full content exceeds token budget. Section outline below.',
  ];

  if (filePath) {
    parts.push(
      `> Use ${toolHint}("${filePath}", startLine=N, endLine=M) to read specific sections.`,
    );
    parts.push(
      '> Ignore any `_meta` fields — they are internal tracking data.',
    );
  }

  parts.push('');
  parts.push(outline || '(no structure found)');

  const compacted = parts.join('\n');

  console.log(
    `📦 [Compact] "${label}": ${content.length.toLocaleString()} chars → ${compacted.length.toLocaleString()} chars (${lineCount} lines)`,
  );

  return {
    content: compacted,
    wasCompacted: true,
    originalChars: content.length,
    compactedChars: compacted.length,
  };
}

function detectContentType(
  label: string,
  filePath?: string,
): 'json' | 'markdown' {
  const source = filePath || label;
  const ext = path.extname(source).toLowerCase();
  if (ext === '.json') return 'json';
  return 'markdown';
}
