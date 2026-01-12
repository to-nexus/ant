/**
 * Prompt Logger
 * 
 * Logs prompts sent to LLM for debugging purposes.
 * Creates files in sessions/logPrompt/ directory.
 * 
 * File naming:
 * - Design Job: prompt-design-{jobId}.md
 * - Code Job: prompt-code-{jobId}.md
 */

import * as path from 'path';
import * as fs from 'fs/promises';

export interface PromptLogEntry {
  nodeId: string;
  taskId?: string;
  taskName?: string;
  timestamp: string;
  templatePath?: string;
  injectedVariables?: Record<string, any>;
  finalPrompt: string;
  tokenEstimate?: number;
}

export interface PromptLoggerOptions {
  featurePath: string;
  jobId: string;
  jobType: 'design' | 'code';
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
    this.logDirPath = path.join(options.featurePath, 'sessions', 'logPrompt');
    this.logFilePath = path.join(
      this.logDirPath,
      `prompt-${options.jobType}-${options.jobId}.md`
    );
  }

  /**
   * Log a prompt entry
   */
  async log(entry: Omit<PromptLogEntry, 'timestamp'>): Promise<void> {
    const fullEntry: PromptLogEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
      tokenEstimate: entry.tokenEstimate ?? this.estimateTokens(entry.finalPrompt),
    };
    
    this.entries.push(fullEntry);
    
    // Write to file immediately (append mode)
    await this.appendToFile(fullEntry);
  }

  /**
   * Estimate token count (rough approximation)
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 3.5);
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
    
    if (entry.templatePath) {
      content += `- **Template**: ${entry.templatePath}\n`;
    }
    
    content += `- **Token Estimate**: ~${entry.tokenEstimate?.toLocaleString()} tokens\n`;
    content += `- **Prompt Length**: ${entry.finalPrompt.length.toLocaleString()} chars\n`;
    
    // Log injected variables (sanitized)
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
    
    // Log final prompt (truncated if too long)
    content += `\n### Final Prompt\n\n`;
    content += '<details>\n<summary>Click to expand prompt</summary>\n\n';
    content += '```\n';
    content += entry.finalPrompt.length > 50000 
      ? entry.finalPrompt.substring(0, 50000) + '\n\n... [TRUNCATED - full prompt is ' + entry.finalPrompt.length + ' chars] ...'
      : entry.finalPrompt;
    content += '\n```\n';
    content += '</details>\n';
    
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
        sanitized[key] = `[ARRAY: ${value.length} items]`;
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
  const key = `${options.jobType}-${options.jobId}`;
  
  if (!loggerInstances.has(key)) {
    loggerInstances.set(key, new PromptLogger(options));
  }
  
  return loggerInstances.get(key)!;
}

/**
 * Clear logger instance (call when job completes)
 */
export function clearPromptLogger(jobType: 'design' | 'code', jobId: string): void {
  const key = `${jobType}-${jobId}`;
  loggerInstances.delete(key);
}

/**
 * Quick logging function for one-off prompt logging
 */
export async function logPrompt(
  featurePath: string,
  jobId: string,
  jobType: 'design' | 'code',
  nodeId: string,
  prompt: string,
  options?: {
    taskId?: string;
    taskName?: string;
    templatePath?: string;
    injectedVariables?: Record<string, any>;
  }
): Promise<void> {
  const logger = getPromptLogger({ featurePath, jobId, jobType });
  await logger.log({
    nodeId,
    taskId: options?.taskId,
    taskName: options?.taskName,
    templatePath: options?.templatePath,
    injectedVariables: options?.injectedVariables,
    finalPrompt: prompt,
  });
}
