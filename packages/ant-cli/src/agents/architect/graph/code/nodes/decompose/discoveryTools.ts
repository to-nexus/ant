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
import { DESIGN_DIR, DESIGN_SUBDIRS } from '@ant/shared';
import { CLARIFY_TOOL, handleClarify, ClarifyContext, createClarifyContext } from '../../../../../common/clarifyTool';

export { CLARIFY_TOOL, createClarifyContext };
export type { ClarifyContext };

// ============================================
// Tool Definitions (LLM schema)
// ============================================

export const LIST_FILES_TOOL: ToolDefinition = {
  name: 'list_files',
  description:
    'List files in a directory. Use scope "artifact" for feature workspace ' +
    '(inputs/sources, outputs/design/ui, outputs/design/system, outputs/design/spec) ' +
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
        description: 'Relative directory path (e.g., "outputs/design/spec" or "src/auth")',
      },
    },
    required: ['scope', 'directory'],
  },
};

export const READ_FILE_TOOL: ToolDefinition = {
  name: 'read_file',
  description:
    'Read file content. Use scope "artifact" for feature workspace files ' +
    'or scope "codebase" for project source files.',
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
        description: 'Relative file path (e.g., "outputs/design/spec/spec-auth.md" or "docs/architecture.md")',
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

// ============================================
// Handlers
// ============================================

export function handleListFiles(
  args: { scope: string; directory: string },
  ctx: DiscoveryToolContext
): string {
  const root = args.scope === 'codebase' ? ctx.codebasePath : ctx.featurePath;
  if (!root) return `Error: ${args.scope} scope is not available`;

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

export function handleReadFile(
  args: { scope: string; path: string },
  ctx: DiscoveryToolContext
): string {
  const root = args.scope === 'codebase' ? ctx.codebasePath : ctx.featurePath;
  if (!root) return `Error: ${args.scope} scope is not available`;

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
    const MAX_SIZE = 100_000;
    if (stat.size > MAX_SIZE) {
      const content = fs.readFileSync(result.resolved, 'utf-8').substring(0, MAX_SIZE);
      return `${content}\n\n--- TRUNCATED (file is ${stat.size} bytes, showing first ${MAX_SIZE}) ---`;
    }
    return fs.readFileSync(result.resolved, 'utf-8');
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
        return handleReadFile(args as { scope: string; path: string }, ctx);
      case 'clarify':
        return handleClarify(args as { question: string; options?: string[] }, ctx.clarify);
      default:
        return `Error: Unknown tool "${name}"`;
    }
  };
}
