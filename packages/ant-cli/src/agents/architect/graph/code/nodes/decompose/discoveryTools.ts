/**
 * Discovery Tools for Decompose Node
 *
 * Provides LLM with file exploration capabilities during task decomposition.
 * Two scopes: 'artifact' (feature workspace) and 'codebase' (project source).
 *
 * Security: paths are resolved relative to their scope root and validated
 * against traversal attacks.
 */

import * as path from 'path';
import * as fs from 'fs';
import type { ToolDefinition } from '../../../../../../core/ports/llm';
import { CLARIFY_TOOL, handleClarify, ClarifyContext, createClarifyContext } from '../../../../../common/clarify';

export { CLARIFY_TOOL, createClarifyContext };
export type { ClarifyContext };

// ============================================
// Tool Definitions (LLM schema)
// ============================================

export const LIST_FILES_TOOL: ToolDefinition = {
  name: 'list_files',
  description:
    'List files in a directory. Use scope "artifact" for feature workspace ' +
    '(plan/, visual/ui/, architecture/system/, architecture/spec/) ' +
    'or scope "codebase" for the project source code (docs/, src/, etc.).',
  input_schema: {
    type: 'object',
    properties: {
      scope: {
        type: 'string',
        enum: ['artifact', 'codebase'],
        description: 'artifact = feature workspace, codebase = project source',
      },
      directory: {
        type: 'string',
        description: 'Relative directory path (e.g., "architecture/spec" or "src/auth")',
      },
    },
    required: ['scope', 'directory'],
  },
};

export const READ_FILE_TOOL: ToolDefinition = {
  name: 'read_file',
  description:
    'Read file content. Use scope "artifact" for feature workspace files ' +
    'or scope "codebase" for project source files. ' +
    'Optionally pass startLine/endLine (1-based, inclusive) to read a range — ' +
    'compacted documents include line-numbered outlines (`L{N}: <heading>`); ' +
    'pass those line numbers to fetch the matching section.',
  input_schema: {
    type: 'object',
    properties: {
      scope: {
        type: 'string',
        enum: ['artifact', 'codebase'],
        description: 'artifact = feature workspace, codebase = project source',
      },
      path: {
        type: 'string',
        description: 'Relative file path (e.g., "architecture/spec/spec-auth.md" or "docs/architecture.md")',
      },
      startLine: {
        type: 'number',
        description: 'Optional. Start line number (1-based, inclusive). Required for files >100K chars; pair with endLine.',
      },
      endLine: {
        type: 'number',
        description: 'Optional. End line number (1-based, inclusive). Use broad ranges (300-500+ lines per call).',
      },
    },
    required: ['scope', 'path'],
  },
};

export const DISCOVERY_TOOLS: ToolDefinition[] = [LIST_FILES_TOOL, READ_FILE_TOOL, CLARIFY_TOOL];

// ============================================
// Handler Context
// ============================================

export interface DiscoveryToolContext {
  featurePath: string;
  codebasePath?: string;
  clarify: ClarifyContext;
  /**
   * RAC whitelist for `scope='artifact'` lookups. Present iff
   * `resolvedAction.source === 'explicit'` AND the RAC has at least one
   * ref/context entry (see `state.artifacts Post-RAC SSOT` in
   * `.cursorrules`). When set, `handleReadFile` / `handleListFiles` MUST
   * reject any artifact-scope path that is not a member of (or descendant
   * of) the union of `refs ∪ context`.
   *
   * `undefined` → infer pipeline (or empty RAC), tools fall through to
   * the legacy "feature workspace root" behaviour. The codebase scope is
   * unaffected by this whitelist — it is sourced from `codebasePath` and
   * answers a different question (project source code, not feature
   * artifacts).
   *
   * The previous `prime-jetting-grate` fix bounded `state.artifacts` to
   * the RAC subset but left this tool surface open, so a decompose LLM
   * could still side-load `architecture/system/fe-system-main.md` from
   * disk via `read_file` even when the user excluded it from the RAC.
   */
  racScope?: { refs: string[]; context: string[] };
}

// ============================================
// Path Validation
// ============================================

function resolveAndValidate(
  scopeRoot: string,
  relativePath: string
): { valid: true; resolved: string } | { valid: false; error: string } {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\//, '');

  if (normalized.includes('..') || path.isAbsolute(relativePath)) {
    return { valid: false, error: 'Path traversal is not allowed' };
  }

  const resolved = path.resolve(scopeRoot, normalized);
  if (!resolved.startsWith(path.resolve(scopeRoot))) {
    return { valid: false, error: 'Path escapes scope root' };
  }

  return { valid: true, resolved };
}

/**
 * Decide whether `requestedPath` (feature-relative, slash-normalized) lies
 * inside the RAC whitelist. A request matches an entry when:
 *
 *   - the entry equals the requested path (exact file slot), OR
 *   - the requested path starts with `entry + '/'` (directory slot), OR
 *   - the entry starts with `requestedPath + '/'` (listing a parent of a
   *     RAC entry — needed so `list_files('architecture')` succeeds when
   *     the RAC carries `architecture/spec/` as a directory slot).
 *
 * Returns `true` when no `racScope` is configured (= infer pipeline). The
 * caller already gated on `scope === 'artifact'`; the codebase scope is
 * orthogonal and never traverses this guard.
 */
function isWithinRacWhitelist(
  requestedPath: string,
  racScope: DiscoveryToolContext['racScope'],
): boolean {
  if (!racScope) return true;

  const entries = [...(racScope.refs ?? []), ...(racScope.context ?? [])]
    .map(p => p.replace(/\\/g, '/').replace(/^\//, '').replace(/\/$/, ''));
  if (entries.length === 0) return true;

  const target = requestedPath.replace(/\\/g, '/').replace(/^\//, '').replace(/\/$/, '');

  for (const entry of entries) {
    if (entry === target) return true;
    if (target.startsWith(entry + '/')) return true;
    if (entry.startsWith(target + '/')) return true;
    if (target === '') return true;
  }
  return false;
}

const RAC_DENY_MESSAGE =
  'Path is outside the RAC selection (refs/context). Decompose with explicit ' +
  'RAC must rely only on user-selected sources — do not read or list files ' +
  'the user did not include in this turn.';

// ============================================
// Handlers
// ============================================

export function handleListFiles(
  args: { scope: string; directory: string },
  ctx: DiscoveryToolContext
): string {
  const root = args.scope === 'codebase' ? ctx.codebasePath : ctx.featurePath;
  if (!root) return `Error: ${args.scope} scope is not available`;

  if (args.scope === 'artifact'
    && !isWithinRacWhitelist(args.directory, ctx.racScope)) {
    return `Error: ${RAC_DENY_MESSAGE}`;
  }

  const result = resolveAndValidate(root, args.directory);
  if (!result.valid) return `Error: ${result.error}`;

  try {
    if (!fs.existsSync(result.resolved)) {
      return `Directory not found: ${args.directory}`;
    }
    const entries = fs.readdirSync(result.resolved, { withFileTypes: true });
    const lines = entries
      .filter(e => !e.name.startsWith('.'))
      .map(e => `${e.isDirectory() ? '[dir] ' : ''}${e.name}`)
      .sort();
    return lines.length > 0
      ? lines.join('\n')
      : `(empty directory: ${args.directory})`;
  } catch (err: any) {
    return `Error listing ${args.directory}: ${err.message}`;
  }
}

/**
 * Threshold above which a `read_file` call without `startLine`/`endLine`
 * is rejected. The LLM is expected to consult the compacted outline in
 * the prompt (or run a paged read) instead of pulling the entire file.
 * Files within this size return the full content unchanged.
 */
const READ_FILE_FULL_READ_LIMIT = 100_000;

export function handleReadFile(
  args: { scope: string; path: string; startLine?: number; endLine?: number },
  ctx: DiscoveryToolContext
): string {
  const root = args.scope === 'codebase' ? ctx.codebasePath : ctx.featurePath;
  if (!root) return `Error: ${args.scope} scope is not available`;

  if (args.scope === 'artifact'
    && !isWithinRacWhitelist(args.path, ctx.racScope)) {
    return `Error: ${RAC_DENY_MESSAGE}`;
  }

  const result = resolveAndValidate(root, args.path);
  if (!result.valid) return `Error: ${result.error}`;

  try {
    if (!fs.existsSync(result.resolved)) {
      return `File not found: ${args.path}`;
    }
    const stat = fs.statSync(result.resolved);
    if (stat.isDirectory()) {
      return `Error: ${args.path} is a directory. Use list_files instead.`;
    }

    const hasRange =
      typeof args.startLine === 'number' || typeof args.endLine === 'number';

    // Reject full reads of oversized files. Truncating silently would hide
    // material from the LLM (the user explicitly forbids automatic
    // truncation); refusing forces the LLM to re-issue with a range
    // sourced from the compacted outline. Mirrors the approach in
    // `core/utils/sourceDocuments.ts#handleReadSourceFile`.
    if (!hasRange && stat.size > READ_FILE_FULL_READ_LIMIT) {
      return (
        `Error: File too large for full read (${stat.size.toLocaleString()} bytes). ` +
        `Use \`read_file("${args.path}", startLine, endLine)\` to read a specific range. ` +
        `Compacted documents in the prompt include line-numbered outlines ` +
        `(\`L{N}: <heading>\`) — pass those line numbers as startLine.`
      );
    }

    const fullContent = fs.readFileSync(result.resolved, 'utf-8');
    if (!hasRange) return fullContent;

    const lines = fullContent.split('\n');
    const totalLines = lines.length;
    const start = Math.max(1, args.startLine ?? 1);
    const end = Math.min(totalLines, args.endLine ?? totalLines);
    if (start > end) {
      return `Error: startLine (${args.startLine}) > endLine (${args.endLine}) for ${args.path}.`;
    }
    const slice = lines.slice(start - 1, end).join('\n');
    return `[Lines ${start}-${end} of ${totalLines}]\n\n${slice}`;
  } catch (err: any) {
    return `Error reading ${args.path}: ${err.message}`;
  }
}

/**
 * Create a unified tool handler for discovery tools.
 * Returns a sync string for list_files/read_file, or a Promise<string> for clarify.
 */
export function createDiscoveryToolHandler(ctx: DiscoveryToolContext) {
  return (name: string, args: Record<string, any>): string | Promise<string> => {
    switch (name) {
      case 'list_files':
        return handleListFiles(args as { scope: string; directory: string }, ctx);
      case 'read_file':
        return handleReadFile(args as { scope: string; path: string; startLine?: number; endLine?: number }, ctx);
      case 'clarify':
        return handleClarify(args as { question: string; options?: string[] }, ctx.clarify);
      default:
        return `Error: Unknown tool "${name}"`;
    }
  };
}
