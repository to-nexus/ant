/**
 * Planner Tools
 *
 * Tools available to the planner agent for research:
 * - read_workspace_file: Read files from user workspace
 * - list_workspace_files: List files in workspace directories
 * - search_web: Search the web for technical information
 * - edit_file: Edit files via search-replace
 * - write_file / append_file: Shadow tools for LLM hallucination recovery
 */

import * as fs from 'fs';
import * as path from 'path';
import type { FileTreeUpdatePort } from '../../../../../core/ports/fileTree';
import type { ChatStatusReporter } from '../../../../common/tool/types';

interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;
  execute: (args: Record<string, any>, ctx: PlannerToolContext) => Promise<string>;
}

export interface PlannerToolContext {
  featurePath: string;
  fileTreeUpdate?: FileTreeUpdatePort;
  chatStatus: ChatStatusReporter;
}

const readWorkspaceFile: ToolDefinition = {
  name: 'read_workspace_file',
  description: 'Read a file from the user workspace. Use relative paths from feature root (e.g., "inputs/sources/prd.md").',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path from feature root' },
    },
    required: ['path'],
  },
  execute: async (args, ctx) => {
    const filePath = path.join(ctx.featurePath, args.path);

    if (!filePath.startsWith(ctx.featurePath)) {
      return 'Error: Path traversal not allowed';
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const maxLen = 10000;
      if (content.length > maxLen) {
        return content.substring(0, maxLen) + `\n\n... (truncated, ${content.length} total chars)`;
      }
      return content;
    } catch (error: any) {
      return `Error reading file: ${error.message}`;
    }
  },
};

const listWorkspaceFiles: ToolDefinition = {
  name: 'list_workspace_files',
  description: 'List files in a workspace directory. Use relative paths from feature root.',
  parameters: {
    type: 'object',
    properties: {
      directory: { type: 'string', description: 'Relative directory path from feature root' },
    },
    required: ['directory'],
  },
  execute: async (args, ctx) => {
    const dirPath = path.join(ctx.featurePath, args.directory);

    if (!dirPath.startsWith(ctx.featurePath)) {
      return 'Error: Path traversal not allowed';
    }

    try {
      const items = fs.readdirSync(dirPath, { withFileTypes: true });
      return items.map(item =>
        `${item.isDirectory() ? '📁' : '📄'} ${item.name}`
      ).join('\n');
    } catch (error: any) {
      return `Error listing directory: ${error.message}`;
    }
  },
};

const searchWeb: ToolDefinition = {
  name: 'search_web',
  description: 'Search the web for technical information, SDK documentation, API references, or technology comparisons. Use when you need current information about technologies, frameworks, or best practices.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
    },
    required: ['query'],
  },
  execute: async (args) => {
    const { executeSearchWeb } = await import('../../../../common/tool/handlers/searchWeb');
    return executeSearchWeb(args as { query: string });
  },
};

const editFile: ToolDefinition = {
  name: 'edit_file',
  description: 'Edit a file by replacing exact text. Provide the relative path from feature root, the exact text to find (old_str), and its replacement (new_str). The old_str must match character-for-character. Use read_workspace_file first if needed.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path from feature root (e.g., "outputs/plan/prd-refine.md")' },
      old_str: { type: 'string', description: 'Exact text to find (must match exactly including whitespace/newlines)' },
      new_str: { type: 'string', description: 'Replacement text. Use empty string to delete.' },
    },
    required: ['path', 'old_str', 'new_str'],
  },
  execute: async (args, ctx) => {
    const filePath = path.join(ctx.featurePath, args.path);

    if (!filePath.startsWith(ctx.featurePath)) {
      return 'Error: Path traversal not allowed';
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const { applySearchReplace } = await import('../../../../../core/streaming/strategies/common/EditOperations');
      const newContent = applySearchReplace(content, args.old_str, args.new_str, args.path);
      fs.writeFileSync(filePath, newContent, 'utf-8');

      notifyFileTree(ctx);
      await ctx.chatStatus.completeFileEdit(args.path, args.old_str, args.new_str);

      return `✅ Edited ${args.path}. Replaced ${args.old_str.length} → ${args.new_str.length} chars.`;
    } catch (error: any) {
      await ctx.chatStatus.failFileEdit(args.path, (error as Error).message);

      if (error.code === 'ENOENT') {
        return `Error: File not found: ${args.path}`;
      }
      return `Error editing file: ${error.message}\n\nTip: Use read_workspace_file to re-read the current content.`;
    }
  },
};

const writeFile: ToolDefinition = {
  name: 'write_file',
  description: 'Shadow tool for LLM hallucination recovery (write_file → <file> tag)',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path from feature root' },
      content: { type: 'string', description: 'File content to write' },
    },
    required: ['path', 'content'],
  },
  execute: async (args, ctx) => {
    return handleHallucinatedFileWrite(args.path, args.content, false, ctx);
  },
};

const appendFile: ToolDefinition = {
  name: 'append_file',
  description: 'Shadow tool for LLM hallucination recovery (append_file → <append> tag)',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path from feature root' },
      content: { type: 'string', description: 'Content to append' },
    },
    required: ['path', 'content'],
  },
  execute: async (args, ctx) => {
    return handleHallucinatedFileWrite(args.path, args.content, true, ctx);
  },
};

function notifyFileTree(ctx: PlannerToolContext): void {
  if (!ctx.fileTreeUpdate) return;
  const projectId = process.env.ANT_PROJECT_ID;
  const featureName = process.env.ANT_FEATURE_NAME;
  if (projectId && featureName) {
    ctx.fileTreeUpdate.notifyFileTreeUpdate(projectId, featureName);
  }
}

async function handleHallucinatedFileWrite(
  filePath: string,
  content: string,
  isAppend: boolean,
  ctx: PlannerToolContext,
): Promise<string> {
  const toolName = isAppend ? 'append_file' : 'write_file';

  if (!content) {
    return `Error: ${toolName} called without content. Use ${isAppend ? '<append>' : '<file>'} XML tag instead.`;
  }

  const resolvedPath = path.join(ctx.featurePath, filePath);

  if (!resolvedPath.startsWith(ctx.featurePath)) {
    return 'Error: Path traversal not allowed';
  }

  try {
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (isAppend && fs.existsSync(resolvedPath)) {
      const existing = fs.readFileSync(resolvedPath, 'utf-8');
      fs.writeFileSync(resolvedPath, existing + '\n' + content, 'utf-8');
    } else {
      fs.writeFileSync(resolvedPath, content, 'utf-8');
    }

    notifyFileTree(ctx);
    await ctx.chatStatus.completeFileEdit(filePath, '', content);

    console.warn(`⚠️  [Tool] LLM hallucinated ${toolName} → auto-converted to file ${isAppend ? 'append' : 'write'} for ${filePath}`);

    const action = isAppend ? 'appended' : 'written';
    return `File ${action} successfully: ${filePath} (auto-recovered from ${toolName} tool call).\n\n` +
      `⚠️ IMPORTANT: "${toolName}" is not a real tool. For future file operations, use the <file path="...">content</file> XML tag format instead.`;
  } catch (error: any) {
    await ctx.chatStatus.failFileEdit(filePath, error.message);
    return `Error ${isAppend ? 'appending to' : 'writing'} file: ${error.message}`;
  }
}

/** Tools advertised to the LLM (tool definitions sent in API call) */
export const PLANNER_TOOLS: ToolDefinition[] = [
  readWorkspaceFile,
  listWorkspaceFiles,
  searchWeb,
  editFile,
];

/** Read-only tools for explain mode (no write/edit capabilities) */
export const PLANNER_EXPLAIN_TOOLS: ToolDefinition[] = [
  readWorkspaceFile,
  listWorkspaceFiles,
  searchWeb,
];

/** All tools including shadow tools for hallucination recovery */
export const ALL_PLANNER_TOOLS: ToolDefinition[] = [
  ...PLANNER_TOOLS,
  writeFile,
  appendFile,
];

/** Map-based dispatch for efficient tool lookup */
export const PLANNER_TOOL_MAP: ReadonlyMap<string, ToolDefinition> = new Map(
  ALL_PLANNER_TOOLS.map(t => [t.name, t]),
);
