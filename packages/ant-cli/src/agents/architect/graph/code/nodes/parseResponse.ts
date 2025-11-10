import { GeneratedFile } from "../state";

// ✅ Export types for external use
export type { EditInstruction };

/**
 * ============================================================================
 * LLM Response Parser
 * ============================================================================
 * 
 * Parses LLM-generated responses to extract:
 * - Response section (explanatory text)
 * - Generated files (code content)
 * - Files to delete
 * 
 * Supports multiple file format conventions:
 * 1. === FILE: path === ... === END FILE ===
 * 2. <file path="...">...</file>
 * 3. <file_path>...</file_path><file_code>...</file_code>
 * 4. ### FILE: path (or ### path) followed by ```code block```
 * 5. #### path followed by ```code block```
 * 
 * Also handles:
 * - <code_output> wrapper
 * - Markdown code fences (```language)
 * - Duplicate file prevention
 */

// ============================================================================
// Types
// ============================================================================

interface ParseResult {
  responseSection: string | null;
  files: GeneratedFile[];
  filesToDelete: string[];
  commands: Command[];  // ✅ Parsed shell commands
  edits: EditInstruction[];  // ✅ NEW: Search/Replace edits
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

const RESPONSE_SECTION_REGEX = /=== RESPONSE ===\n([\s\S]*?)\n=== END RESPONSE ===/;
const CODE_OUTPUT_WRAPPER_REGEX = /<code_output>([\s\S]*?)<\/code_output>/;

// File format parsers (order matters: later parsers override earlier ones)
const FILE_PARSERS: FileParser[] = [
  {
    name: 'Standard Format',
    regex: /=== FILE: (.+?) ===\n([\s\S]*?)\n=== END FILE ===/g,
    extractPath: (m) => m[1].trim(),
    extractContent: (m) => m[2].trim(),
  },
  {
    name: 'XML Format',
    regex: /<file path="([^"]+)">\s*([\s\S]*?)\s*<\/file>/g,
    extractPath: (m) => m[1].trim(),
    extractContent: (m) => m[2].trim(),
  },
  {
    name: 'Path+Code Format',
    regex: /<file_path>(.+?)<\/file_path>\s*<file_code>([\s\S]*?)<\/file_code>/g,
    extractPath: (m) => m[1].trim(),
    extractContent: (m) => m[2].trim(),
  },
  {
    name: 'Markdown Header H3 + Code Block',
    // Matches: ### FILE: path or ### path
    // Followed by optional language identifier and code block
    regex: /###\s*(?:FILE:\s*)?(.+?)\s*\n```[\w]*\s*\n([\s\S]*?)\n```/g,
    extractPath: (m) => m[1].trim(),
    extractContent: (m) => m[2].trim(),
  },
  {
    name: 'Markdown Header H4 + Code Block',
    // Matches: #### path
    // Followed by optional language identifier and code block
    regex: /####\s+(.+?)\s*\n```[\w]*\s*\n([\s\S]*?)\n```/g,
    extractPath: (m) => m[1].trim(),
    extractContent: (m) => m[2].trim(),
  },
];

// Delete format parsers
const DELETE_PARSERS: DeleteParser[] = [
  {
    name: 'Standard Format',
    regex: /=== DELETE: (.+?) ===/g,
    extractPath: (m) => m[1].trim(),
  },
  {
    name: 'XML Format',
    regex: /<delete path="([^"]+)"\s*\/>/g,
    extractPath: (m) => m[1].trim(),
  },
];

// ✅ Edit format parsers (Search/Replace)
const EDIT_PARSERS: EditParser[] = [
  {
    name: 'Search/Replace Format',
    regex: /=== EDIT: (.+?) ===\n<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE\n=== END EDIT ===/g,
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
 * Extracts content from <code_output> wrapper if present
 */
function unwrapCodeOutput(raw: string): string {
  const match = raw.match(CODE_OUTPUT_WRAPPER_REGEX);
  return match ? match[1] : raw;
}

/**
 * Extracts response section (explanatory text) from content
 */
function extractResponseSection(content: string): string | null {
  const match = RESPONSE_SECTION_REGEX.exec(content);
  return match ? match[1].trim() : null;
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
  // 1. Unwrap code output wrapper if present
  const content = unwrapCodeOutput(raw);
  
  // 2. Extract response section
  const responseSection = extractResponseSection(content);
  
  // 3. Parse all files (using Map to prevent duplicates)
  const fileMap = parseFiles(content);
  
  // 4. Parse all delete directives
  const filesToDelete = parseDeletes(content);
  
  // 5. ✅ Parse edit instructions (search/replace)
  const edits = parseEdits(content);
  
  // 6. ✅ Parse shell commands
  const commands = parseCommands(content);
  
  // 7. Return structured result
  return {
    responseSection,
    files: Array.from(fileMap.values()),
    filesToDelete,
    edits,  // ✅ NEW: Include edit instructions
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
