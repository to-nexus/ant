/**
 * Base interfaces for language-specific error parsers
 */

export interface ParsedError {
  /** Raw error message */
  raw: string;
  
  /** Error type/code (e.g., "TS2304", "E001") */
  code?: string;
  
  /** Source file path */
  file?: string;
  
  /** Line number */
  line?: number;
  
  /** Column number */
  column?: number;
  
  /** Severity level */
  severity: 'error' | 'warning' | 'info';
  
  /** Human-readable message */
  message: string;
  
  /** Suggested fix */
  suggestion?: string;
  
  /** Additional context lines */
  context?: string[];
}

export interface ErrorParserOptions {
  /** Include warnings in results */
  includeWarnings?: boolean;
  
  /** Maximum number of errors to parse */
  maxErrors?: number;
  
  /** Project root path for relative path resolution */
  projectRoot?: string;
}

export abstract class BaseErrorParser {
  protected options: ErrorParserOptions;
  
  constructor(options: ErrorParserOptions = {}) {
    this.options = {
      includeWarnings: false,
      maxErrors: 100,
      ...options
    };
  }
  
  /**
   * Parse error output and return structured errors
   */
  abstract parse(output: string): ParsedError[];
  
  /**
   * Format parsed errors for display/LLM
   */
  format(errors: ParsedError[]): string[] {
    return errors.map(err => this.formatSingle(err));
  }
  
  protected formatSingle(error: ParsedError): string {
    const parts: string[] = [];
    
    // Location info
    if (error.file) {
      let location = error.file;
      if (error.line) {
        location += `:${error.line}`;
        if (error.column) {
          location += `:${error.column}`;
        }
      }
      parts.push(location);
    }
    
    // Error code and message
    const codePrefix = error.code ? `[${error.code}] ` : '';
    parts.push(`${codePrefix}${error.message}`);
    
    // Context
    if (error.context && error.context.length > 0) {
      error.context.forEach(ctx => parts.push(`  ${ctx}`));
    }
    
    // Suggestion
    if (error.suggestion) {
      parts.push(`💡 ${error.suggestion}`);
    }
    
    return parts.join('\n');
  }
  
  /**
   * Check if output indicates tool is missing
   */
  protected isToolMissing(output: string, toolPatterns: string[]): boolean {
    return toolPatterns.some(pattern => 
      output.toLowerCase().includes(pattern.toLowerCase())
    );
  }
  
  /**
   * Extract all matches from output
   */
  protected extractMatches(output: string, pattern: RegExp): RegExpMatchArray[] {
    const matches: RegExpMatchArray[] = [];
    let match: RegExpExecArray | null;
    
    // Reset regex state
    pattern.lastIndex = 0;
    
    while ((match = pattern.exec(output)) !== null) {
      matches.push(match as RegExpMatchArray);
      
      if (matches.length >= (this.options.maxErrors || 100)) {
        break;
      }
    }
    
    return matches;
  }
}
