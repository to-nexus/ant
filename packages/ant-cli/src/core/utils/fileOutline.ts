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
 * - JSON (.json): top-level keys with value previews
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

function extractMarkdownHeadings(content: string): string[] {
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

function extractJsonOutline(content: string): string[] {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return [];
    }
  } catch {
    return [];
  }

  const keys = Object.keys(parsed);
  if (keys.length === 0) return [];

  const lines = content.split('\n');
  const entries: string[] = [];

  for (const key of keys) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^\\s*"${escapedKey}"\\s*:`);
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) {
        const preview = jsonValuePreview(parsed[key]);
        entries.push(`L${i + 1}: "${key}": ${preview}`);
        break;
      }
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
