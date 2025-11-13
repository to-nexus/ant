import { GeneratedFile } from "../../state";

// ✅ Export types for external use
export type { EditInstruction };

/**
 * ============================================================================
 * LLM Response Parser (Fallback)
 * ============================================================================
 * 
 * Fallback parser for any content not caught by real-time streaming.
 * Primary parsing happens in XMLStreamParser during streaming.
 * 
 * This parser handles:
 * - XML format: <file path="...">...</file>
 * - XML edits: <edit path="..."><search>...</search><replace>...</replace></edit>
 * - XML deletes: <delete path="..." />
 * - Commands: ```bash ... ```
 * 
 * Note: This is only used for content that somehow wasn't streamed.
 * Real-time parsing happens in core/streaming/parsers/XMLStreamParser.ts
 */

// ============================================================================
// Types
// ============================================================================

interface ParseResult {
  files: GeneratedFile[];
  filesToDelete: string[];
  commands: Command[];
  edits: EditInstruction[];
}

interface EditInstruction {
  path: string;
  search: string;
  replace: string;
}

interface Command {
  command: string;
  cwd?: string;  // Optional working directory
  description?: string;  // Optional description from LLM
}

interface FileParser {
  name: string;
  regex: RegExp;
  extractPath: (match: RegExpExecArray) => string;
  extractContent: (match: RegExpExecArray) => string;
}

interface DeleteParser {
  name: string;
  regex: RegExp;
  extractPath: (match: RegExpExecArray) => string;
}

interface EditParser {
  name: string;
  regex: RegExp;
  extractPath: (match: RegExpExecArray) => string;
  extractSearch: (match: RegExpExecArray) => string;
  extractReplace: (match: RegExpExecArray) => string;
}

// ============================================================================
// Constants
// ============================================================================

// File format parser (XML only - primary format)
const FILE_PARSERS: FileParser[] = [
  {
    name: 'XML Format',
    regex: /<file path="([^"]+)">\s*([\s\S]*?)\s*<\/file>/g,
    extractPath: (m) => m[1].trim(),
    extractContent: (m) => m[2].trim(),
  },
];

// Delete format parser (XML only)
const DELETE_PARSERS: DeleteParser[] = [
  {
    name: 'XML Format',
    regex: /<delete path="([^"]+)"\s*\/>/g,
    extractPath: (m) => m[1].trim(),
  },
];

// Edit format parser (XML only - Search/Replace)
const EDIT_PARSERS: EditParser[] = [
  {
    name: 'XML Edit Format',
    regex: /<edit path="([^"]+)">\s*<search>\s*([\s\S]*?)\s*<\/search>\s*<replace>\s*([\s\S]*?)\s*<\/replace>\s*<\/edit>/g,
    extractPath: (m) => m[1].trim(),
    extractSearch: (m) => m[2].trim(),
    extractReplace: (m) => m[3].trim(),
  },
];

// ✅ Command format parsers
const COMMAND_PARSERS = [
  {
    name: 'Bash Code Block',
    // Matches: ```bash ... ``` or ```sh ... ```
    regex: /```(?:bash|sh)\n([\s\S]*?)\n```/g,
    extractCommands: (match: RegExpExecArray) => {
      const commandBlock = match[1].trim();
      // Split by newlines and filter out comments and empty lines
      return commandBlock
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'))
        .map(cmd => ({ command: cmd }));
    },
  },
  {
    name: 'Structured Command Format',
    // Matches: === COMMAND: description === ... === END COMMAND ===
    regex: /=== COMMAND:?\s*(.*?)\s*===\n([\s\S]*?)\n=== END COMMAND ===/g,
    extractCommands: (match: RegExpExecArray) => {
      const description = match[1].trim() || undefined;
      const commandBlock = match[2].trim();
      return commandBlock
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'))
        .map(cmd => ({ 
          command: cmd,
          description: description 
        }));
    },
  },
];

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Removes markdown code fences from content
 * Handles both inline fences (```language) and multiline wrapping
 */
function cleanMarkdownFences(content: string): string {
  let cleaned = content;
  
  // Remove start/end fences
  cleaned = cleaned.replace(/^```[\w]*\s*\n/, '').replace(/\n```\s*$/, '');
  
  // Handle fully wrapped content
  if (cleaned.startsWith('```')) {
    const lines = cleaned.split('\n');
    
    // Remove opening fence
    if (lines[0].match(/^```[\w]*$/)) {
      lines.shift();
    }
    
    // Remove closing fence
    if (lines.length > 0 && lines[lines.length - 1].match(/^```\s*$/)) {
      lines.pop();
    }
    
    cleaned = lines.join('\n').trim();
  }
  
  return cleaned;
}

/**
 * No preprocessing needed for XML format
 * (kept for backward compatibility)
 */
function unwrapCodeOutput(raw: string): string {
  return raw;
}

/**
 * Parses files using all registered file parsers
 * Later parsers override earlier ones for duplicate paths
 */
function parseFiles(content: string): Map<string, GeneratedFile> {
  const fileMap = new Map<string, GeneratedFile>();
  
  for (const parser of FILE_PARSERS) {
    let match: RegExpExecArray | null;
    
    while ((match = parser.regex.exec(content)) !== null) {
      const filePath = parser.extractPath(match);
      const rawContent = parser.extractContent(match);
      const cleanedContent = cleanMarkdownFences(rawContent);
      
      fileMap.set(filePath, {
        path: filePath,
        content: cleanedContent,
      });
    }
  }
  
  return fileMap;
}

/**
 * Parses file deletion directives using all registered delete parsers
 */
function parseDeletes(content: string): string[] {
  const deletePaths: string[] = [];
  
  for (const parser of DELETE_PARSERS) {
    let match: RegExpExecArray | null;
    
    while ((match = parser.regex.exec(content)) !== null) {
      const filePath = parser.extractPath(match);
      deletePaths.push(filePath);
    }
  }
  
  return deletePaths;
}

/**
 * ✅ Parses edit instructions (search/replace) using all registered edit parsers
 */
function parseEdits(content: string): EditInstruction[] {
  const edits: EditInstruction[] = [];
  
  for (const parser of EDIT_PARSERS) {
    let match: RegExpExecArray | null;
    
    while ((match = parser.regex.exec(content)) !== null) {
      edits.push({
        path: parser.extractPath(match),
        search: parser.extractSearch(match),
        replace: parser.extractReplace(match),
      });
    }
  }
  
  return edits;
}

/**
 * ✅ Parses shell commands using all registered command parsers
 */
function parseCommands(content: string): Command[] {
  const commands: Command[] = [];
  
  for (const parser of COMMAND_PARSERS) {
    let match: RegExpExecArray | null;
    
    while ((match = parser.regex.exec(content)) !== null) {
      const parsedCommands = parser.extractCommands(match);
      commands.push(...parsedCommands);
    }
  }
  
  return commands;
}

// ============================================================================
// Main Export
// ============================================================================

/**
 * Parses LLM response to extract structured data
 * 
 * @param raw - Raw LLM response text
 * @returns Parsed result containing response section, files, and deletes
 * 
 * @example
 * ```typescript
 * const result = parseResponse(llmOutput);
 * console.log(`Found ${result.files.length} files`);
 * console.log(`Found ${result.filesToDelete.length} deletes`);
 * ```
 */
export function parseResponse(raw: string): ParseResult {
  // 1. No preprocessing needed for XML format
  const content = unwrapCodeOutput(raw);
  
  // 2. Parse all files (using Map to prevent duplicates)
  const fileMap = parseFiles(content);
  
  // 3. Parse all delete directives
  const filesToDelete = parseDeletes(content);
  
  // 4. Parse edit instructions (search/replace)
  const edits = parseEdits(content);
  
  // 5. Parse shell commands
  const commands = parseCommands(content);
  
  // 6. Return structured result
  return {
    files: Array.from(fileMap.values()),
    filesToDelete,
    edits,
    commands,
  };
}

// ============================================================================
// Debug Helper (for development/testing)
// ============================================================================

/**
 * Returns parser statistics for debugging
 * @internal
 */
export function getParserInfo() {
  return {
    fileParsers: FILE_PARSERS.map(p => p.name),
    deleteParsers: DELETE_PARSERS.map(p => p.name),
    supportedFormats: {
      files: FILE_PARSERS.length,
      deletes: DELETE_PARSERS.length,
    },
  };
}
