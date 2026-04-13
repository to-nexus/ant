/**
 * Content Condenser
 *
 * Unified utility for condensing large documents before prompt injection.
 * When content exceeds a character threshold, it is replaced with a
 * structural outline (line-numbered TOC) plus an instruction to use
 * read_file(path, startLine, endLine) for on-demand access.
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

export interface CondenseOptions {
  /** Character-count threshold. Content at or below this is returned as-is. */
  threshold: number;
  /** Human-readable document label shown in the condensed header. */
  label: string;
  /**
   * File path for read_file instruction (e.g. "outputs/design/ui/ui-assets.json").
   * When omitted the condensed output omits the read_file hint.
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

export interface CondenseResult {
  content: string;
  wasCondensed: boolean;
  originalChars: number;
  condensedChars: number;
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
 * Condense content that exceeds `threshold` characters into a structural
 * outline with line numbers and a read_file access hint.
 *
 * When the content is within budget it is returned unchanged.
 */
export function condenseContent(
  content: string,
  options: CondenseOptions,
): CondenseResult {
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
      wasCondensed: false,
      originalChars: content.length,
      condensedChars: content.length,
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
    `# ${label} (${lineCount} lines, condensed)`,
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

  const condensed = parts.join('\n');

  console.log(
    `📦 [Condense] "${label}": ${content.length.toLocaleString()} chars → ${condensed.length.toLocaleString()} chars (${lineCount} lines)`,
  );

  return {
    content: condensed,
    wasCondensed: true,
    originalChars: content.length,
    condensedChars: condensed.length,
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
