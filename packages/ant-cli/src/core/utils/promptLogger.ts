/**
 * Prompt Logger
 * 
 * Logs prompt STRUCTURE (not content) for debugging purposes.
 * - Template files used
 * - Injected variables summary
 * - Hardcoded content (if any, not from template files)
 * 
 * Creates files in sessions/debug/prompts/ directory.
 * 
 * File naming: prompt-{jobId}.md
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { getSessionDebugDir } from './sessionPaths';

export interface PromptLogEntry {
  nodeId: string;
  taskId?: string;
  taskName?: string;
  /** nth LLM call within this task (for cross-reference with tokens/ log) */
  callIndex?: number;
  timestamp: string;
  /** Main template file path (e.g., 'design/phases/execute/base-ui-design') */
  templatePath?: string;
  /** Additional template files used (partials, injections) */
  usedTemplates?: string[];
  /** Summary of injected variables */
  injectedVariables?: Record<string, any>;
  /** Hardcoded content (not from template files) - only log this */
  hardcodedContent?: string;
  /** Prompt length for reference */
  promptLength?: number;
  tokenEstimate?: number;
  /** Handlebars partials resolved inside the rendered templates */
  resolvedPartials?: string[];
  /** Variables or partials that were missing during render */
  contractViolations?: Array<{ templateName: string; missingVars: string[] }>;
}

export interface PromptLoggerOptions {
  featurePath: string;
  jobId: string;
  jobType: 'design' | 'code' | 'plan';
}

/**
 * Prompt Logger class for tracking prompts across nodes
 */
export class PromptLogger {
  private entries: PromptLogEntry[] = [];
  private options: PromptLoggerOptions;
  private logDirPath: string;
  private logFilePath: string;

  constructor(options: PromptLoggerOptions) {
    this.options = options;
    const agent = options.jobType === 'plan' ? 'planner' : 'architect';
    this.logDirPath = getSessionDebugDir(options.featurePath, agent, 'prompts');
    this.logFilePath = path.join(
      this.logDirPath,
      `prompt-${options.jobId}.md`
    );
  }

  /**
   * Log a prompt entry
   */
  async log(entry: Omit<PromptLogEntry, 'timestamp'>): Promise<void> {
    const promptLength = entry.promptLength || 0;
    const fullEntry: PromptLogEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
      tokenEstimate: entry.tokenEstimate ?? this.estimateTokens(promptLength),
    };
    
    this.entries.push(fullEntry);
    
    // Write to file immediately (append mode)
    await this.appendToFile(fullEntry);
  }

  /**
   * Estimate token count (rough approximation)
   */
  private estimateTokens(charLength: number): number {
    return Math.ceil(charLength / 3.5);
  }

  /**
   * Ensure log directory exists
   */
  private async ensureLogDir(): Promise<void> {
    try {
      await fs.mkdir(this.logDirPath, { recursive: true });
    } catch (error) {
      // Directory might already exist
    }
  }

  /**
   * Append entry to log file
   */
  private async appendToFile(entry: PromptLogEntry): Promise<void> {
    await this.ensureLogDir();
    
    const content = this.formatEntry(entry);
    
    try {
      // Check if file exists
      try {
        await fs.access(this.logFilePath);
        // File exists, append
        await fs.appendFile(this.logFilePath, content);
      } catch {
        // File doesn't exist, create with header
        const header = this.formatHeader();
        await fs.writeFile(this.logFilePath, header + content);
      }
      
      console.log(`📋 [PromptLogger] Logged prompt for ${entry.nodeId}${entry.taskId ? ` (task: ${entry.taskId})` : ''}`);
    } catch (error) {
      console.error(`❌ [PromptLogger] Failed to write log:`, error);
    }
  }

  /**
   * Format log file header
   */
  private formatHeader(): string {
    return `# Prompt Log: ${this.options.jobType.toUpperCase()} Job
    
- **Job ID**: ${this.options.jobId}
- **Job Type**: ${this.options.jobType}
- **Created**: ${new Date().toISOString()}
- **Feature Path**: ${this.options.featurePath}

---

`;
  }

  /**
   * Format a single entry
   */
  private formatEntry(entry: PromptLogEntry): string {
    let content = `## Node: ${entry.nodeId}\n\n`;
    
    content += `- **Timestamp**: ${entry.timestamp}\n`;
    
    if (entry.taskId) {
      content += `- **Task ID**: ${entry.taskId}\n`;
    }
    
    if (entry.taskName) {
      content += `- **Task Name**: ${entry.taskName}\n`;
    }
    
    if (entry.callIndex !== undefined) {
      content += `- **Call Index**: ${entry.callIndex}\n`;
    }
    
    // ✅ Log template files used (primary info)
    if (entry.templatePath) {
      content += `- **Main Template**: \`${entry.templatePath}.md\`\n`;
    }
    
    if (entry.usedTemplates && entry.usedTemplates.length > 0) {
      content += `- **Used Templates**:\n`;
      for (const tpl of entry.usedTemplates) {
        content += `  - \`${tpl}.md\`\n`;
      }
    }
    
    if (entry.resolvedPartials && entry.resolvedPartials.length > 0) {
      content += `- **Resolved Partials**:\n`;
      for (const p of entry.resolvedPartials) {
        content += `  - \`${p}.md\`\n`;
      }
    }
    
    // Prompt stats (not content)
    if (entry.promptLength) {
      content += `- **Prompt Length**: ${entry.promptLength.toLocaleString()} chars\n`;
    }
    if (entry.tokenEstimate) {
      content += `- **Token Estimate**: ~${entry.tokenEstimate.toLocaleString()} tokens\n`;
    }
    
    // Log injected variables (sanitized summary)
    if (entry.injectedVariables && Object.keys(entry.injectedVariables).length > 0) {
      content += `\n### Injected Variables\n\n`;
      content += '```json\n';
      content += JSON.stringify(
        this.sanitizeVariables(entry.injectedVariables),
        null,
        2
      );
      content += '\n```\n';
    }
    
    if (entry.contractViolations && entry.contractViolations.length > 0) {
      content += `\n### ⚠️ Contract Violations\n\n`;
      for (const v of entry.contractViolations) {
        content += `- **${v.templateName}**: missing \`${v.missingVars.join('`, `')}\`\n`;
      }
      content += '\n';
    }

    if (entry.hardcodedContent) {
      content += `\n### Hardcoded Content\n\n`;
      content += '```\n';
      content += entry.hardcodedContent.length > 2000 
        ? entry.hardcodedContent.substring(0, 2000) + '\n\n... [TRUNCATED] ...'
        : entry.hardcodedContent;
      content += '\n```\n';
    }
    
    content += '\n---\n\n';
    
    return content;
  }

  /**
   * Sanitize variables for logging (remove large content, show summary)
   */
  private sanitizeVariables(vars: Record<string, any>): Record<string, any> {
    const sanitized: Record<string, any> = {};
    
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined || value === null) {
        sanitized[key] = value;
      } else if (typeof value === 'string') {
        if (value.length > 500) {
          sanitized[key] = `[STRING: ${value.length} chars]`;
        } else {
          sanitized[key] = value;
        }
      } else if (Array.isArray(value)) {
        // Keep small string arrays as-is for readability (e.g. packages, designDocFiles, uiDocSections)
        if (value.length <= 10 && value.every(v => typeof v === 'string')) {
          sanitized[key] = value;
        } else {
          sanitized[key] = `[ARRAY: ${value.length} items]`;
        }
      } else if (typeof value === 'object') {
        sanitized[key] = `[OBJECT: ${Object.keys(value).length} keys]`;
      } else {
        sanitized[key] = value;
      }
    }
    
    return sanitized;
  }

  /**
   * Get all logged entries
   */
  getEntries(): PromptLogEntry[] {
    return [...this.entries];
  }

  /**
   * Get log file path
   */
  getLogFilePath(): string {
    return this.logFilePath;
  }
}

/**
 * Global prompt logger instances (one per job)
 */
const loggerInstances: Map<string, PromptLogger> = new Map();

/**
 * Get or create a prompt logger for a job
 */
export function getPromptLogger(options: PromptLoggerOptions): PromptLogger {
  const key = options.jobId;
  
  if (!loggerInstances.has(key)) {
    loggerInstances.set(key, new PromptLogger(options));
  }
  
  return loggerInstances.get(key)!;
}

/**
 * Clear logger instance (call when job completes)
 */
export function clearPromptLogger(jobType: 'design' | 'code' | 'plan', jobId: string): void {
  loggerInstances.delete(jobId);
}

/**
 * Quick logging function for one-off prompt logging
 * 
 * @param featurePath - Feature directory path
 * @param jobId - Job ID
 * @param jobType - 'design' or 'code'
 * @param nodeId - Node identifier (e.g., 'decompose', 'codeGen')
 * @param promptLength - Length of the prompt in chars (for stats)
 * @param options - Additional options
 *   - templatePath: Main template file (e.g., 'design/phases/execute/base-ui-design')
 *   - usedTemplates: Additional template files used
 *   - injectedVariables: Summary of injected variables
 *   - hardcodedContent: Content not from template files
 */
export async function logPrompt(
  featurePath: string,
  jobId: string,
  jobType: 'design' | 'code' | 'plan',
  nodeId: string,
  promptLength: number,
  options?: {
    taskId?: string;
    taskName?: string;
    callIndex?: number;
    templatePath?: string;
    usedTemplates?: string[];
    resolvedPartials?: string[];
    injectedVariables?: Record<string, any>;
    hardcodedContent?: string;
    contractViolations?: Array<{ templateName: string; missingVars: string[] }>;
  }
): Promise<void> {
  const logger = getPromptLogger({ featurePath, jobId, jobType });
  await logger.log({
    nodeId,
    taskId: options?.taskId,
    taskName: options?.taskName,
    callIndex: options?.callIndex,
    templatePath: options?.templatePath,
    usedTemplates: options?.usedTemplates,
    resolvedPartials: options?.resolvedPartials,
    injectedVariables: options?.injectedVariables,
    hardcodedContent: options?.hardcodedContent,
    contractViolations: options?.contractViolations,
    promptLength,
  });
}
