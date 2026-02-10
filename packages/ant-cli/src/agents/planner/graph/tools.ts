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

interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;
  execute: (args: Record<string, any>) => Promise<string>;
}

// Workspace feature path (set by runner before graph execution)
let workspaceFeaturePath: string | undefined;

export function setPlannerWorkspaceFeaturePath(featurePath?: string) {
  workspaceFeaturePath = featurePath;
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
 * 
 * Requires ANT_TAVILY_API_KEY environment variable.
 * Falls back gracefully to a placeholder when key is not configured.
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
    const apiKey = process.env.ANT_TAVILY_API_KEY;
    
    if (!apiKey) {
      console.log(`🔍 [Planner:WebSearch] No API key configured, using graceful fallback`);
      return `Web search is not configured (ANT_TAVILY_API_KEY not set). Please use your existing knowledge or ask the user for specific information about: "${args.query}"`;
    }
    
    console.log(`🔍 [Planner:WebSearch] Searching: ${args.query}`);
    
    try {
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          api_key: apiKey,
          query: args.query,
          search_depth: 'basic',
          max_results: 5,
          include_answer: true,
        }),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`🔍 [Planner:WebSearch] API error (${response.status}): ${errorText}`);
        return `Web search failed (HTTP ${response.status}). Please proceed with available information about: "${args.query}"`;
      }
      
      const data = await response.json() as {
        answer?: string;
        results?: Array<{ title: string; url: string; content: string }>;
      };
      
      // Format results for the LLM
      const sections: string[] = [];
      
      if (data.answer) {
        sections.push(`## Summary\n${data.answer}`);
      }
      
      if (data.results && data.results.length > 0) {
        sections.push('## Sources');
        for (const result of data.results) {
          const snippet = result.content.length > 500 
            ? result.content.substring(0, 500) + '...' 
            : result.content;
          sections.push(`### ${result.title}\n${result.url}\n${snippet}`);
        }
      }
      
      const output = sections.join('\n\n');
      console.log(`🔍 [Planner:WebSearch] Found ${data.results?.length || 0} results`);
      return output || 'No relevant results found.';
    } catch (error: any) {
      console.error(`🔍 [Planner:WebSearch] Error: ${error.message}`);
      return `Web search encountered an error: ${error.message}. Please proceed with available information about: "${args.query}"`;
    }
  },
};

export const PLANNER_TOOLS: ToolDefinition[] = [
  readWorkspaceFile,
  listWorkspaceFiles,
  searchWeb,
];
