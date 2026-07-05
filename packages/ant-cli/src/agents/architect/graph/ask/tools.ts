/**
 * Ask Tools
 * 
 * Tools for exploring Ant source code with security filters.
 * All tools enforce whitelist/blacklist path validation.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  readAntSource as coreReadAntSource,
  listAntFiles as coreListAntFiles,
  searchAntCode as coreSearchAntCode,
  sanitizeOutput,
  FORBIDDEN_PATTERNS,
  type AntSource as AskSource,
} from '../../../common/tool/antSource/core';

// ============================================================
// Path Security (Blacklist approach)
// ============================================================

const DEBUG = process.env.ASK_DEBUG === 'true';

// Ant-source read/list/search logic (cli/ui/docs scope) + its security
// helpers (FORBIDDEN_PATTERNS, sanitizeOutput) now live in the shared core
// module (common/tool/antSource/core.ts) so the code/design jobs reuse them.
// The three exports below are thin delegations kept for the ask tool node's
// existing imports + ASK_TOOLS schema.

// ============================================================
// Tool Definitions
// ============================================================

export interface ToolResult {
  success: boolean;
  content?: string;
  error?: string;
}

/**
 * Read a file from Ant source code — delegates to the shared core.
 */
export async function readAntSource(args: { path: string; source?: AskSource }): Promise<ToolResult> {
  return coreReadAntSource(args);
}

/**
 * List files in an Ant source directory — delegates to the shared core.
 */
export async function listAntFiles(args: { path: string; source?: AskSource }): Promise<ToolResult> {
  return coreListAntFiles(args);
}

/**
 * Search Ant source code — delegates to the shared core.
 */
export async function searchAntCode(args: { query: string; source?: AskSource; filePattern?: string }): Promise<ToolResult> {
  return coreSearchAntCode(args);
}


// ============================================================
// Tool Schema for LLM
// ============================================================

export const ASK_TOOLS = [
  {
    name: 'read_ant_source',
    description: 'Read a file from Ant source code or documentation. Use this to understand how Ant works.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path to the file (e.g., "core/data/triage/jobs/design.yaml" for cli, "rubric/PRD-RUBRIC.md" for docs)',
        },
        source: {
          type: 'string',
          enum: ['cli', 'ui', 'docs'],
          description: 'Source: "cli" for ant-cli source, "ui" for ant-ui source, "docs" for project documentation (docs/ directory including rubrics, architecture, guides). Default: cli',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_ant_files',
    description: 'List files in a directory of Ant source code or documentation.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path to the directory (e.g., "core/data/triage/jobs" for cli, "rubric" for docs)',
        },
        source: {
          type: 'string',
          enum: ['cli', 'ui', 'docs'],
          description: 'Source: "cli" for ant-cli source, "ui" for ant-ui source, "docs" for project documentation (docs/ directory including rubrics, architecture, guides). Default: cli',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'search_ant_code',
    description: 'Search for text in Ant source code or documentation.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Text to search for',
        },
        source: {
          type: 'string',
          enum: ['cli', 'ui', 'docs'],
          description: 'Source to search: "cli" for ant-cli, "ui" for ant-ui, "docs" for project documentation. Default: cli',
        },
        filePattern: {
          type: 'string',
          description: 'File pattern to match (e.g., "*.yaml", "*.ts", "*.md"). Default: *.ts for cli/ui, *.md for docs',
        },
      },
      required: ['query'],
    },
  },
];

// ============================================================
// Workspace File Tools (read user's workspace files)
// ============================================================

/** Workspace context for workspace tools */
let _workspaceFeaturePath: string | undefined;

/**
 * Set the workspace feature path for workspace tools.
 * Must be called before using workspace tools.
 */
export function setWorkspaceFeaturePath(featurePath: string | undefined): void {
  _workspaceFeaturePath = featurePath;
}

/**
 * Allowed workspace directories for reading (security whitelist).
 * Domain-grouped: plan/architecture/visual/assets/meta + sessions.
 */
const ALLOWED_WORKSPACE_DIRS = [
  'plan/',          // PRD, GDD, source documents
  'architecture/',  // system / spec design docs
  'visual/',        // ui / game-art design docs
  'assets/',        // service / game / gen asset pools
  'meta/',          // directives / evals
  'sessions/',      // Session state (chat history etc.)
];

/**
 * Validate workspace path against whitelist
 */
function validateWorkspacePath(relativePath: string): { valid: boolean; reason?: string } {
  const normalized = path.normalize(relativePath).replace(/\\/g, '/');
  
  // Check for path traversal
  if (normalized.includes('..')) {
    return { valid: false, reason: 'Path traversal not allowed' };
  }
  
  // Check against allowed directories
  const isAllowed = ALLOWED_WORKSPACE_DIRS.some(dir => 
    normalized.startsWith(dir) || normalized === dir.replace('/', '')
  );
  
  if (!isAllowed) {
    return { valid: false, reason: `Access restricted. Allowed directories: ${ALLOWED_WORKSPACE_DIRS.join(', ')}` };
  }
  
  // Also check blacklist
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(normalized)) {
      return { valid: false, reason: 'Security: access denied' };
    }
  }
  
  return { valid: true };
}

/**
 * Read a file from user's workspace
 */
export async function readWorkspaceFile(args: { path: string }): Promise<ToolResult> {
  if (!_workspaceFeaturePath) {
    return { success: false, error: 'Workspace context not available' };
  }
  
  const relativePath = args.path;
  
  if (DEBUG) {
    console.log(`📖 [AskTool] readWorkspaceFile: ${relativePath}`);
  }
  
  // Validate path
  const validation = validateWorkspacePath(relativePath);
  if (!validation.valid) {
    return { success: false, error: validation.reason };
  }
  
  const fullPath = path.join(_workspaceFeaturePath, relativePath);
  
  if (!fs.existsSync(fullPath)) {
    return { success: false, error: `File not found: ${relativePath}` };
  }
  
  try {
    const content = fs.readFileSync(fullPath, 'utf-8');
    const sanitized = sanitizeOutput(content);
    
    // Limit content length (larger limit for workspace files like PRDs)
    const maxLength = 30000;
    if (sanitized.length > maxLength) {
      return {
        success: true,
        content: sanitized.substring(0, maxLength) + '\n\n[... truncated, file too large ...]',
      };
    }
    
    return { success: true, content: sanitized };
  } catch (error: any) {
    return { success: false, error: `Failed to read file: ${error.message}` };
  }
}

/**
 * List files in user's workspace directory
 */
export async function listWorkspaceFiles(args: { path: string }): Promise<ToolResult> {
  if (!_workspaceFeaturePath) {
    return { success: false, error: 'Workspace context not available' };
  }
  
  const relativePath = args.path;
  
  if (DEBUG) {
    console.log(`📂 [AskTool] listWorkspaceFiles: ${relativePath}`);
  }
  
  // Validate path
  const validation = validateWorkspacePath(relativePath);
  if (!validation.valid) {
    return { success: false, error: validation.reason };
  }
  
  const fullPath = path.join(_workspaceFeaturePath, relativePath);
  
  if (!fs.existsSync(fullPath)) {
    return { success: false, error: `Directory not found: ${relativePath}` };
  }
  
  if (!fs.statSync(fullPath).isDirectory()) {
    return { success: false, error: `Not a directory: ${relativePath}` };
  }
  
  try {
    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    const items = entries
      .filter(e => !e.name.startsWith('.'))
      .map(e => ({
        name: e.name,
        type: e.isDirectory() ? 'dir' : 'file',
      }));
    
    return {
      success: true,
      content: JSON.stringify(items, null, 2),
    };
  } catch (error: any) {
    return { success: false, error: `Failed to list directory: ${error.message}` };
  }
}

/**
 * Workspace tool schemas for LLM
 */
export const WORKSPACE_TOOLS = [
  {
    name: 'read_workspace_file',
    description: 'Read a file from the user\'s current workspace (feature directory). Use this to read PRDs, design documents, directives, and other workspace files.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path within the feature directory (e.g., "plan/prd.md", "architecture/system/be-system-main.md")',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_workspace_files',
    description: 'List files in a directory of the user\'s current workspace (feature directory).',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path to the directory (e.g., "plan", "architecture/system")',
        },
      },
      required: ['path'],
    },
  },
];

// ============================================================
// Tool Execution
// ============================================================

/**
 * Execute a tool by name
 */
export async function executeTool(name: string, args: Record<string, any>): Promise<ToolResult> {
  switch (name) {
    case 'read_ant_source':
      return readAntSource(args as { path: string; source?: AskSource });
    case 'list_ant_files':
      return listAntFiles(args as { path: string; source?: AskSource });
    case 'search_ant_code':
      return searchAntCode(args as { query: string; source?: AskSource; filePattern?: string });
    case 'read_workspace_file':
      return readWorkspaceFile(args as { path: string });
    case 'list_workspace_files':
      return listWorkspaceFiles(args as { path: string });
    default:
      return { success: false, error: `Unknown tool: ${name}` };
  }
}
