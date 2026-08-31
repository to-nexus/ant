/**
 * Ant-source read/list/search core
 *
 * Shared SSOT for reading Ant's OWN in-image source (cli / ui / docs / shared) with
 * security filters. Extracted from the ask job so the code / design jobs can
 * reuse the exact same logic (self-diagnosis of app↔platform boundary
 * defects) without a layering inversion into the ask graph.
 *
 * In-image fidelity: `getCliRoot` maps `/dist` → `/src`, so the source read
 * here is the EXACT running version (the runtime image ships the source and
 * runs it via `tsx`). No git clone — a "latest" clone would drift ahead of
 * the running pod and mislead diagnosis.
 */

import * as fs from 'fs';
import * as path from 'path';
import { WorkspacePathResolver } from '../../../../core/config/WorkspacePathResolver.js';
import { coerceLineRange } from '../handlers/lineRange.js';

const DEBUG = process.env.ASK_DEBUG === 'true';

/**
 * Forbidden path patterns (blacklist). Only block security-sensitive paths;
 * allow everything else.
 */
export const FORBIDDEN_PATTERNS = [
  // Security-sensitive files
  /\.env/i,
  /secret/i,
  /credentials?/i,
  /password/i,
  /private[-_]?key/i,
  /api[-_]?key/i,

  // Infrastructure (may contain deployment configs)
  /infrastructure\/auth\//,
  /infrastructure\/networking\//,

  // Build artifacts and dependencies
  /node_modules\//,
  /\.git\//,
  /dist\//,
  /\.next\//,
  /coverage\//,
];

/** Source type for ant-source tools. */
export type AntSource = 'cli' | 'ui' | 'docs' | 'shared';

/** Result shape shared with the ask job's local ToolResult. */
export interface AntSourceResult {
  success: boolean;
  content?: string;
  error?: string;
}

/** Get ant-cli root path (dist → src for actual source files). */
function getCliRoot(): string {
  const cliRoot = WorkspacePathResolver.getCliRoot();
  if (cliRoot.includes('/dist')) {
    return cliRoot.replace('/dist', '/src');
  }
  return cliRoot;
}

/** Get ant-ui root path (packages/ant-cli/src → packages/ant-ui). */
function getUiRoot(): string {
  return path.resolve(getCliRoot(), '../../ant-ui');
}

/** Get monorepo docs root path (docs/ is at the monorepo root, sibling of packages/). */
function getDocsRoot(): string {
  return path.resolve(getCliRoot(), '../../../docs');
}

/** Get @ant/shared source root (the BE↔FE contract SSOT — types live in src, not dist). */
function getSharedRoot(): string {
  return path.resolve(getCliRoot(), '../../ant-shared/src');
}

export function resolveSourceRoot(source: AntSource): string {
  switch (source) {
    case 'cli': return getCliRoot();
    case 'ui': return getUiRoot();
    case 'docs': return getDocsRoot();
    case 'shared': return getSharedRoot();
  }
}

/** Validate path against blacklist (security-only filtering). */
export function validatePath(relativePath: string): { valid: boolean; reason?: string } {
  const normalized = path.normalize(relativePath).replace(/\\/g, '/');

  if (normalized.includes('..')) {
    return { valid: false, reason: 'Path traversal not allowed' };
  }

  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(normalized)) {
      return { valid: false, reason: `Security: access denied` };
    }
  }

  return { valid: true };
}

/** Sanitize output to mask sensitive information (conservative). */
export function sanitizeOutput(content: string): string {
  return content
    .replace(/(['"])[A-Za-z0-9+/=]{32,}(['"])/g, '$1[REDACTED]$2')  // Base64-like strings
    .replace(/(['"])sk-[A-Za-z0-9]{20,}(['"])/g, '$1[REDACTED]$2')  // API keys
    .replace(/password\s*[:=]\s*['"][^'"]+['"]/gi, 'password=[REDACTED]');
}

/** Read a file from Ant source code. */
export async function readAntSource(args: {
  path: string;
  source?: AntSource;
  startLine?: number | string;
  endLine?: number | string;
}): Promise<AntSourceResult> {
  const source = args.source || 'cli';
  const relativePath = args.path;
  const { startLine, endLine } = coerceLineRange(args);

  if (DEBUG) console.log(`📖 [AntSource] readAntSource: ${source}/${relativePath}`);

  const validation = validatePath(relativePath);
  if (!validation.valid) {
    return { success: false, error: validation.reason };
  }

  const rootPath = resolveSourceRoot(source);
  const fullPath = path.join(rootPath, relativePath);

  if (!fs.existsSync(fullPath)) {
    return { success: false, error: `File not found: ${relativePath}` };
  }

  try {
    const content = fs.readFileSync(fullPath, 'utf-8');
    const sanitized = sanitizeOutput(content);

    // Limit content length (higher for docs since rubrics/guides need full content)
    const maxLength = source === 'docs' ? 50000 : 10000;
    const lines = sanitized.split('\n');
    const total = lines.length;

    const hasRange = startLine !== undefined || endLine !== undefined;
    let body = sanitized;
    let header = '';
    if (hasRange) {
      const start = Math.max(1, startLine ?? 1);
      const end = Math.min(total, endLine ?? total);
      if (start > end) {
        return { success: false, error: `startLine (${start}) > endLine (${end}) for ${relativePath}.` };
      }
      body = lines.slice(start - 1, end).join('\n');
      header = `[Lines ${start}-${end} of ${total}]\n\n`;
    }

    // Cap AFTER slicing — a range starting past the cap must still return
    // content, otherwise a large file's tail is unreachable by any tool.
    if (body.length > maxLength) {
      body =
        body.substring(0, maxLength) +
        `\n\n[... truncated at ${maxLength} chars — file has ${total} lines; re-issue with startLine/endLine to read beyond this point ...]`;
    }

    return { success: true, content: header + body };
  } catch (error: any) {
    return { success: false, error: `Failed to read file: ${error.message}` };
  }
}

/**
 * Probe the ant-source roots for a path that missed in the workspace.
 * Read-only backstop for read_file's not-found reply: a plan citation in the
 * ant-source namespace must redirect to read_ant_source, not to rediscovery.
 * Tolerates missing roots (deployed images do not ship the ui tree).
 */
export function findInAntSourceRoots(relativePath: string): AntSource | undefined {
  if (!relativePath || !validatePath(relativePath).valid) return undefined;
  for (const source of ['cli', 'ui', 'docs', 'shared'] as AntSource[]) {
    try {
      const root = resolveSourceRoot(source);
      if (fs.existsSync(root) && fs.existsSync(path.join(root, relativePath))) return source;
    } catch {
      // Unresolvable root (partial image) — keep probing the others.
    }
  }
  return undefined;
}

/**
 * Map an ant-source path to its location inside a workspace clone of the Ant
 * monorepo (`codebase/` namespace). Same layout knowledge as
 * `resolveSourceRoot` — keep the two in sync.
 */
export function antSourceToCodebasePath(source: AntSource, relativePath: string): string {
  switch (source) {
    case 'cli': return `codebase/packages/ant-cli/src/${relativePath}`;
    case 'ui': return `codebase/packages/ant-ui/${relativePath}`;
    case 'docs': return `codebase/docs/${relativePath}`;
    case 'shared': return `codebase/packages/ant-shared/src/${relativePath}`;
  }
}

/** List files in an Ant source directory. */
export async function listAntFiles(args: { path: string; source?: AntSource }): Promise<AntSourceResult> {
  const source = args.source || 'cli';
  const relativePath = args.path;

  if (DEBUG) console.log(`📂 [AntSource] listAntFiles: ${source}/${relativePath}`);

  const normalized = path.normalize(relativePath).replace(/\\/g, '/');
  if (normalized.includes('..')) {
    return { success: false, error: 'Path traversal not allowed' };
  }

  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(normalized)) {
      return { success: false, error: `Forbidden path: ${pattern}` };
    }
  }

  const rootPath = resolveSourceRoot(source);
  const fullPath = path.join(rootPath, relativePath);

  if (!fs.existsSync(fullPath)) {
    return { success: false, error: `Directory not found: ${relativePath}` };
  }

  if (!fs.statSync(fullPath).isDirectory()) {
    return { success: false, error: `Not a directory: ${relativePath}` };
  }

  try {
    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    const items = entries
      .filter(e => !e.name.startsWith('.'))  // Skip hidden files
      .map(e => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' }));

    return { success: true, content: JSON.stringify(items, null, 2) };
  } catch (error: any) {
    return { success: false, error: `Failed to list directory: ${error.message}` };
  }
}

/** Search for text in Ant source code. */
export async function searchAntCode(args: {
  query: string;
  source?: AntSource;
  filePattern?: string;
}): Promise<AntSourceResult> {
  const source = args.source || 'cli';
  const query = args.query;
  const filePattern = args.filePattern || (source === 'docs' ? '*.md' : '*.ts');

  if (DEBUG) console.log(`🔍 [AntSource] searchAntCode: "${query}" in ${source} (${filePattern})`);

  if (!query || query.length < 2) {
    return { success: false, error: 'Query too short (min 2 chars)' };
  }
  if (query.length > 100) {
    return { success: false, error: 'Query too long (max 100 chars)' };
  }

  const rootPath = resolveSourceRoot(source);

  // A missing root must be a loud error, not "No matches found" — in a
  // deployed image the `ui` source is not shipped, and a silently empty
  // result reads as "the code doesn't exist".
  if (!fs.existsSync(rootPath)) {
    return { success: false, error: `Source root not available: ${source} (${rootPath})` };
  }

  const results: { file: string; line: number; content: string }[] = [];
  const maxResults = 20;

  function searchDir(dir: string, relativeTo: string) {
    if (results.length >= maxResults) return;

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (results.length >= maxResults) return;
        if (entry.name.startsWith('.')) continue;
        if (entry.name === 'node_modules') continue;

        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(relativeTo, fullPath);

        const isForbidden = FORBIDDEN_PATTERNS.some(p => p.test(relPath));
        if (isForbidden) continue;

        if (entry.isDirectory()) {
          searchDir(fullPath, relativeTo);
        } else if (entry.isFile()) {
          if (filePattern !== '*' && !entry.name.endsWith(filePattern.replace('*', ''))) {
            continue;
          }

          const validation = validatePath(relPath);
          if (!validation.valid) continue;

          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const lines = content.split('\n');

            lines.forEach((line, idx) => {
              if (results.length >= maxResults) return;
              if (line.toLowerCase().includes(query.toLowerCase())) {
                results.push({ file: relPath, line: idx + 1, content: line.substring(0, 200) });
              }
            });
          } catch {
            // Skip unreadable files
          }
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  searchDir(rootPath, rootPath);

  if (results.length === 0) {
    return { success: true, content: 'No matches found' };
  }

  const output = results.map(r => `${r.file}:${r.line}: ${r.content}`).join('\n');

  return {
    success: true,
    content: results.length >= maxResults
      ? `${output}\n\n[... more results truncated, showing first ${maxResults} ...]`
      : output,
  };
}
