/**
 * Ask Tools
 * 
 * Tools for exploring Ant source code with security filters.
 * All tools enforce whitelist/blacklist path validation.
 */

import * as fs from 'fs';
import * as path from 'path';
import { WorkspacePathResolver } from '../../../../infrastructure/workspace/WorkspaceResolver.js';

// ============================================================
// Path Security (Blacklist approach)
// ============================================================

const DEBUG = process.env.ASK_DEBUG === 'true';

/**
 * Forbidden path patterns (blacklist)
 * Only block security-sensitive paths; allow everything else
 */
const FORBIDDEN_PATTERNS = [
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

/**
 * Get ant-cli root path
 */
function getCliRoot(): string {
  const cliRoot = WorkspacePathResolver.getCliRoot();
  // Go from dist to src for actual source files
  if (cliRoot.includes('/dist')) {
    return cliRoot.replace('/dist', '/src');
  }
  return cliRoot;
}

/**
 * Get ant-ui root path
 */
function getUiRoot(): string {
  const cliRoot = getCliRoot();
  // ant-cli/src -> ../../ant-ui (packages/ant-cli/src -> packages/ant-ui)
  return path.resolve(cliRoot, '../../ant-ui');
}

/**
 * Get monorepo docs root path
 * docs/ is at the monorepo root level (sibling of packages/)
 */
function getDocsRoot(): string {
  const cliRoot = getCliRoot();
  // ant-cli/src -> ../../../docs (packages/ant-cli/src -> docs)
  return path.resolve(cliRoot, '../../../docs');
}

/** Source type for ask tools */
type AskSource = 'cli' | 'ui' | 'docs';

/**
 * Resolve root path for a given source
 */
function resolveSourceRoot(source: AskSource): string {
  switch (source) {
    case 'cli': return getCliRoot();
    case 'ui': return getUiRoot();
    case 'docs': return getDocsRoot();
  }
}

/**
 * Validate path against blacklist (security-only filtering)
 */
function validatePath(relativePath: string, _source: AskSource): { valid: boolean; reason?: string } {
  // Normalize path
  const normalized = path.normalize(relativePath).replace(/\\/g, '/');
  
  // Check for path traversal
  if (normalized.includes('..')) {
    return { valid: false, reason: 'Path traversal not allowed' };
  }
  
  // Check blacklist only
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(normalized)) {
      return { valid: false, reason: `Security: access denied` };
    }
  }
  
  return { valid: true };
}

/**
 * Sanitize output to mask sensitive information
 */
function sanitizeOutput(content: string): string {
  // Mask potential secrets (very conservative)
  return content
    .replace(/(['"])[A-Za-z0-9+/=]{32,}(['"])/g, '$1[REDACTED]$2')  // Base64-like strings
    .replace(/(['"])sk-[A-Za-z0-9]{20,}(['"])/g, '$1[REDACTED]$2')  // API keys
    .replace(/password\s*[:=]\s*['"][^'"]+['"]/gi, 'password=[REDACTED]');
}

// ============================================================
// Tool Definitions
// ============================================================

export interface ToolResult {
  success: boolean;
  content?: string;
  error?: string;
}

/**
 * Read a file from Ant source code
 */
export async function readAntSource(args: { path: string; source?: AskSource }): Promise<ToolResult> {
  const source = args.source || 'cli';
  const relativePath = args.path;
  
  if (DEBUG) {
    console.log(`📖 [AskTool] readAntSource: ${source}/${relativePath}`);
  }
  
  // Validate path
  const validation = validatePath(relativePath, source);
  if (!validation.valid) {
    return { success: false, error: validation.reason };
  }
  
  // Resolve full path
  const rootPath = resolveSourceRoot(source);
  const fullPath = path.join(rootPath, relativePath);
  
  // Check file exists
  if (!fs.existsSync(fullPath)) {
    return { success: false, error: `File not found: ${relativePath}` };
  }
  
  // Read and sanitize
  try {
    const content = fs.readFileSync(fullPath, 'utf-8');
    const sanitized = sanitizeOutput(content);
    
    // Limit content length (higher for docs since rubrics/guides need full content)
    const maxLength = source === 'docs' ? 50000 : 10000;
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
 * List files in a directory
 */
export async function listAntFiles(args: { path: string; source?: AskSource }): Promise<ToolResult> {
  const source = args.source || 'cli';
  const relativePath = args.path;
  
  if (DEBUG) {
    console.log(`📂 [AskTool] listAntFiles: ${source}/${relativePath}`);
  }
  
  // Basic path validation (allow directories)
  const normalized = path.normalize(relativePath).replace(/\\/g, '/');
  if (normalized.includes('..')) {
    return { success: false, error: 'Path traversal not allowed' };
  }
  
  // Check blacklist
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(normalized)) {
      return { success: false, error: `Forbidden path: ${pattern}` };
    }
  }
  
  // Resolve full path
  const rootPath = resolveSourceRoot(source);
  const fullPath = path.join(rootPath, relativePath);
  
  // Check directory exists
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
 * Search for text in Ant source code
 */
export async function searchAntCode(args: { 
  query: string; 
  source?: AskSource;
  filePattern?: string;
}): Promise<ToolResult> {
  const source = args.source || 'cli';
  const query = args.query;
  const filePattern = args.filePattern || (source === 'docs' ? '*.md' : '*.ts');
  
  if (DEBUG) {
    console.log(`🔍 [AskTool] searchAntCode: "${query}" in ${source} (${filePattern})`);
  }
  
  // Validate query
  if (!query || query.length < 2) {
    return { success: false, error: 'Query too short (min 2 chars)' };
  }
  
  if (query.length > 100) {
    return { success: false, error: 'Query too long (max 100 chars)' };
  }
  
  const rootPath = resolveSourceRoot(source);
  
  // Simple recursive search (limited)
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
        
        // Skip forbidden paths
        const isForbidden = FORBIDDEN_PATTERNS.some(p => p.test(relPath));
        if (isForbidden) continue;
        
        if (entry.isDirectory()) {
          searchDir(fullPath, relativeTo);
        } else if (entry.isFile()) {
          // Check file pattern
          if (filePattern !== '*' && !entry.name.endsWith(filePattern.replace('*', ''))) {
            continue;
          }
          
          // Check whitelist
          const validation = validatePath(relPath, source);
          if (!validation.valid) continue;
          
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const lines = content.split('\n');
            
            lines.forEach((line, idx) => {
              if (results.length >= maxResults) return;
              if (line.toLowerCase().includes(query.toLowerCase())) {
                results.push({
                  file: relPath,
                  line: idx + 1,
                  content: line.substring(0, 200),
                });
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
  
  const output = results
    .map(r => `${r.file}:${r.line}: ${r.content}`)
    .join('\n');
  
  return {
    success: true,
    content: results.length >= maxResults 
      ? `${output}\n\n[... more results truncated, showing first ${maxResults} ...]`
      : output,
  };
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
 * Allowed workspace directories for reading (security whitelist)
 */
const ALLOWED_WORKSPACE_DIRS = [
  'inputs/',    // PRD, directives, references, assets
  'outputs/',   // Design docs, generated code
  'sessions/',  // Session state (chat history etc.)
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
          description: 'Relative path within the feature directory (e.g., "inputs/sources/prd.md", "outputs/design/system/be-system-main.md")',
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
          description: 'Relative path to the directory (e.g., "inputs/sources", "outputs/design/system")',
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
