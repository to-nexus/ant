/**
 * Planner Tools
 * 
 * Tools available to the planner agent for research:
 * - read_workspace_file: Read files from user workspace
 * - list_workspace_files: List files in workspace directories
 * - search_web: Search the web for technical information
 */

import * as fs from 'fs';
import * as path from 'path';
import type { FileTreeUpdatePort } from '../../../core/ports/fileTree';
import { getChatAPIClient } from '../../../core/adapters/ChatAPIClient';

interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;
  execute: (args: Record<string, any>) => Promise<string>;
}

// Workspace feature path (set by runner before graph execution)
let workspaceFeaturePath: string | undefined;
// File tree update port (set by runner before graph execution)
let fileTreeUpdatePort: FileTreeUpdatePort | undefined;

export function setPlannerWorkspaceFeaturePath(featurePath?: string) {
  workspaceFeaturePath = featurePath;
}

export function setPlannerFileTreeUpdate(fileTreeUpdate?: FileTreeUpdatePort) {
  fileTreeUpdatePort = fileTreeUpdate;
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
  execute: async (args) => {
    if (!workspaceFeaturePath) {
      return 'Error: No workspace context available';
    }
    
    const filePath = path.join(workspaceFeaturePath, args.path);
    
    // Security: prevent path traversal
    if (!filePath.startsWith(workspaceFeaturePath)) {
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
  execute: async (args) => {
    if (!workspaceFeaturePath) {
      return 'Error: No workspace context available';
    }
    
    const dirPath = path.join(workspaceFeaturePath, args.directory);
    
    if (!dirPath.startsWith(workspaceFeaturePath)) {
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

/**
 * Web search via Tavily API.
 * Delegates to shared executeSearchWeb (architect/tools/searchWeb.ts).
 */
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
    const { executeSearchWeb } = await import('../../architect/tools/searchWeb');
    return executeSearchWeb(args as { query: string });
  },
};

/**
 * edit_file — same interface as architect's edit_file (path, old_str, new_str).
 * Uses applySearchReplace from EditOperations.ts for consistency.
 * Paths are relative to feature root, same as read_workspace_file.
 */
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
  execute: async (args) => {
    if (!workspaceFeaturePath) {
      return 'Error: No workspace context available';
    }

    const filePath = path.join(workspaceFeaturePath, args.path);

    // Security: prevent path traversal
    if (!filePath.startsWith(workspaceFeaturePath)) {
      return 'Error: Path traversal not allowed';
    }

    // ✅ NOTE: Loading card (file_editing) is already created by tool_use event handler
    // in generate.ts via chatAPI.sendLLMEvent(event) → LLMEventHandler.handleFileToolUse()
    const chatAPI = getChatAPIClient();
    
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const { applySearchReplace } = await import('../../../core/streaming/strategies/common/EditOperations');
      const newContent = applySearchReplace(content, args.old_str, args.new_str, args.path);
      fs.writeFileSync(filePath, newContent, 'utf-8');
      
      // ✅ Notify file tree update after edit
      if (fileTreeUpdatePort) {
        const projectId = process.env.ANT_PROJECT_ID;
        const featureName = process.env.ANT_FEATURE_NAME;
        if (projectId && featureName) {
          fileTreeUpdatePort.notifyFileTreeUpdate(projectId, featureName);
        }
      }
      
      // ✅ UI notification: file edit complete (file_editing → file_edit with diff)
      await chatAPI.completeFileEdit(args.path, args.old_str, args.new_str);
      
      return `✅ Edited ${args.path}. Replaced ${args.old_str.length} → ${args.new_str.length} chars.`;
    } catch (error: any) {
      // ✅ UI notification: file edit failed (file_editing → file_edit_failed)
      await chatAPI.failFileEdit(args.path, (error as Error).message);
      
      if (error.code === 'ENOENT') {
        return `Error: File not found: ${args.path}`;
      }
      return `Error editing file: ${error.message}\n\nTip: Use read_workspace_file to re-read the current content.`;
    }
  },
};

export const PLANNER_TOOLS: ToolDefinition[] = [
  readWorkspaceFile,
  listWorkspaceFiles,
  searchWeb,
  editFile,
];
