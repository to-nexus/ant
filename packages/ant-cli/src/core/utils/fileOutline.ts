/**
 * File Outline Generator
 *
 * Generates structural outlines (table of contents with line numbers) for different file types.
 * Used by ToolResultManager to provide navigation maps when file content is truncated,
 * enabling the LLM to make targeted startLine/endLine requests.
 *
 * Supported formats:
 * - Markdown (.md, .mdx, .txt): heading extraction
 * - TypeScript/JavaScript (.ts, .tsx, .js, .jsx, .mjs, .mts): top-level declarations
 * - Go (.go): top-level func/type/var/const
 * - JSON (.json): top-level keys with value previews; array-of-objects values
 *                  (and top-level arrays of objects) are expanded one level
 *                  with element labels (id/name/title/...) and line numbers
 *                  so the LLM can target a single element without paging.
 * - YAML (.yaml, .yml): top-level keys
 */

import * as path from 'path';

const MAX_OUTLINE_LENGTH = 2000;

/**
 * Generate a structural outline for a file based on its extension.
 * Returns null for unsupported file types or files with no extractable structure.
 */
export function generateFileOutline(content: string, filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();

  let entries: string[];

  switch (ext) {
    case '.md':
    case '.mdx':
    case '.txt':
      entries = extractMarkdownHeadings(content);
      break;
    case '.ts':
    case '.tsx':
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.mts':
      entries = extractTypeScriptOutline(content);
      break;
    case '.go':
      entries = extractGoOutline(content);
      break;
    case '.json':
      entries = extractJsonOutline(content);
      break;
    case '.yaml':
    case '.yml':
      entries = extractYamlOutline(content);
      break;
    default:
      return null;
  }

  if (entries.length === 0) return null;

  const outline = entries.join('\n');
  if (outline.length <= MAX_OUTLINE_LENGTH) return outline;

  const truncated = outline.slice(0, MAX_OUTLINE_LENGTH);
  const lastNewline = truncated.lastIndexOf('\n');
  return (lastNewline > 0 ? truncated.slice(0, lastNewline) : truncated) + '\n...';
}

export function extractMarkdownHeadings(content: string): string[] {
  const lines = content.split('\n');
  const entries: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,6})\s+(.+)/);
    if (match) {
      const level = match[1].length;
      const indent = '  '.repeat(level - 1);
      entries.push(`L${i + 1}: ${indent}${lines[i].trim()}`);
    }
  }

  return entries;
}

function extractTypeScriptOutline(content: string): string[] {
  const lines = content.split('\n');
  const entries: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^export\s+(default\s+)?(function|class|interface|type|const|let|var|enum|abstract)\s/.test(trimmed)) {
      entries.push(`L${i + 1}: ${trimmed.replace(/\s*[{=].*$/, '')}`);
    } else if (
      /^(function|class|abstract\s+class)\s/.test(trimmed) &&
      lines[i][0] !== ' ' && lines[i][0] !== '\t'
    ) {
      entries.push(`L${i + 1}: ${trimmed.replace(/\s*\{.*$/, '')}`);
    }
  }

  return entries;
}

function extractGoOutline(content: string): string[] {
  const lines = content.split('\n');
  const entries: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^package\s+\w+/.test(trimmed)) {
      entries.push(`L${i + 1}: ${trimmed}`);
    } else if (/^type\s+\w+/.test(trimmed)) {
      entries.push(`L${i + 1}: ${trimmed.replace(/\s*\{.*$/, '')}`);
    } else if (/^func\s/.test(trimmed)) {
      entries.push(`L${i + 1}: ${trimmed.replace(/\s*\{.*$/, '')}`);
    } else if (/^(var|const)\s+\w+/.test(trimmed) && !trimmed.startsWith('var (') && !trimmed.startsWith('const (')) {
      entries.push(`L${i + 1}: ${trimmed.replace(/\s*=.*$/, '')}`);
    }
  }

  return entries;
}

export function extractJsonOutline(content: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }

  const lines = content.split('\n');
  const entries: string[] = [];

  // Top-level array of objects → element-level outline.
  // ui-spec.json / API response payloads commonly arrive in this shape;
  // surfacing element ids lets the LLM jump to the relevant slice without
  // page-walking the whole file.
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return [];
    if (!isArrayOfObjects(parsed)) return [];
    const arrayOpenLineIdx = findFirstLine(lines, (line) => line.trimStart().startsWith('['));
    if (arrayOpenLineIdx < 0) return [];
    entries.push(`L${arrayOpenLineIdx + 1}: [...] (${parsed.length} items)`);
    appendArrayElementsOutline(parsed as Record<string, unknown>[], lines, arrayOpenLineIdx, entries, '  ');
    return entries;
  }

  if (typeof parsed !== 'object' || parsed === null) return [];

  const obj = parsed as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 0) return [];

  for (const key of keys) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^\\s*"${escapedKey}"\\s*:`);
    const lineIdx = findFirstLine(lines, (line) => pattern.test(line));
    if (lineIdx < 0) continue;
    const value = obj[key];
    entries.push(`L${lineIdx + 1}: "${key}": ${jsonValuePreview(value)}`);

    // Depth-1 expansion: when a top-level key holds an array of objects,
    // surface element ids so `read_file(startLine, endLine)` can target a
    // single element without walking the array.
    if (Array.isArray(value) && value.length > 0 && isArrayOfObjects(value)) {
      appendArrayElementsOutline(value as Record<string, unknown>[], lines, lineIdx, entries, '  ');
    }
  }

  return entries;
}

function jsonValuePreview(value: unknown): string {
  if (typeof value === 'string') {
    return `"${value.length > 30 ? value.slice(0, 30) + '...' : value}"`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[...] (${value.length} items)`;
  if (typeof value === 'object' && value !== null) return `{...} (${Object.keys(value).length} keys)`;
  return String(value);
}

function isArrayOfObjects(arr: unknown[]): boolean {
  return arr.every((v) => typeof v === 'object' && v !== null && !Array.isArray(v));
}

function findFirstLine(lines: string[], predicate: (line: string) => boolean): number {
  for (let i = 0; i < lines.length; i++) {
    if (predicate(lines[i])) return i;
  }
  return -1;
}

// Cap to keep the outline scannable for the LLM; MAX_OUTLINE_LENGTH (2000 chars)
// will still truncate the final string. The per-array cap protects against
// pathological cases where one array dominates the outline budget.
const MAX_ARRAY_ELEMENTS_PER_OUTLINE = 50;

function appendArrayElementsOutline(
  arr: Record<string, unknown>[],
  lines: string[],
  arrayStartLineIdx: number,
  entries: string[],
  labelIndent: string,
): void {
  const baseIndent = lines[arrayStartLineIdx].match(/^\s*/)?.[0].length ?? 0;
  let detectedElementIndent: number | null = null;
  let elementIdx = 0;
  const cap = Math.min(arr.length, MAX_ARRAY_ELEMENTS_PER_OUTLINE);

  for (let i = arrayStartLineIdx + 1; i < lines.length; i++) {
    if (elementIdx >= cap) break;
    const line = lines[i];
    const leadingWs = line.match(/^\s*/)?.[0].length ?? 0;
    const trimmed = line.slice(leadingWs);

    // Array close at or before base indent → done.
    if (leadingWs <= baseIndent && (trimmed.startsWith(']') || trimmed.startsWith('}'))) return;

    if (detectedElementIndent === null) {
      if (trimmed.startsWith('{')) detectedElementIndent = leadingWs;
      else continue;
    }

    if (leadingWs === detectedElementIndent && trimmed.startsWith('{')) {
      const elem = arr[elementIdx];
      const label = elem ? pickElementLabel(elem) : null;
      entries.push(`L${i + 1}: ${labelIndent}[${elementIdx}]${label ? ` (${label})` : ''}`);
      elementIdx++;
    }
  }

  if (arr.length > cap) {
    entries.push(`L?: ${labelIndent}... (${arr.length - cap} more items omitted)`);
  }
}

const LABEL_KEY_PRIORITY = ['id', 'name', 'title', 'key', 'label', 'type', 'slug'];

function pickElementLabel(elem: Record<string, unknown>): string | null {
  for (const k of LABEL_KEY_PRIORITY) {
    const v = elem[k];
    if (typeof v === 'string') return `${k}="${v.length > 30 ? v.slice(0, 30) + '...' : v}"`;
    if (typeof v === 'number' || typeof v === 'boolean') return `${k}=${v}`;
  }
  // Fallback: first string value in the element.
  for (const [k, v] of Object.entries(elem)) {
    if (typeof v === 'string' && v.length > 0) {
      return `${k}="${v.length > 30 ? v.slice(0, 30) + '...' : v}"`;
    }
  }
  return null;
}

function extractYamlOutline(content: string): string[] {
  const lines = content.split('\n');
  const entries: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^[a-zA-Z_][\w.-]*\s*:/.test(line)) {
      entries.push(`L${i + 1}: ${line.trim()}`);
    }
  }

  return entries;
}
