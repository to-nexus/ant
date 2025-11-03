/**
 * TypeScript Error Parser
 * 
 * Parses output from:
 * - tsc --noEmit
 * - tsc (build output)
 */

import { BaseErrorParser, ParsedError, ErrorParserOptions } from './base';

export class TypeScriptErrorParser extends BaseErrorParser {
  constructor(options: ErrorParserOptions = {}) {
    super(options);
  }
  
  parse(output: string): ParsedError[] {
    // Check if tsc is missing
    if (this.isToolMissing(output, [
      'This is not the tsc command',
      'command not found: tsc',
      'tsc: command not found'
    ])) {
      return [{
        raw: output,
        severity: 'error',
        message: 'TypeScript compiler (tsc) is not installed or not in PATH',
        suggestion: 'Run: npm install --save-dev typescript',
        context: [
          `Current NODE_ENV: ${process.env.NODE_ENV || 'not set'}`,
          'Possible causes:',
          '  1. NODE_ENV=production preventing devDependencies',
          '  2. npm install ran with --production flag',
          '  3. .npmrc has production=true'
        ]
      }];
    }
    
    const errors: ParsedError[] = [];
    const lines = output.split('\n');
    
    let currentError: Partial<ParsedError> | null = null;
    let contextLines: string[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trimEnd();
      
      // TypeScript error format:
      // src/App.tsx(10,5): error TS2304: Cannot find name 'React'.
      const errorMatch = line.match(/^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+(TS\d+):\s*(.+)$/);
      
      if (errorMatch) {
        // Save previous error
        if (currentError) {
          errors.push(this.finalizeError(currentError, contextLines));
          contextLines = [];
        }
        
        const [, file, lineNum, col, severity, code, message] = errorMatch;
        
        currentError = {
          raw: line,
          file: file.trim(),
          line: parseInt(lineNum, 10),
          column: parseInt(col, 10),
          severity: severity === 'error' ? 'error' : 'warning',
          code,
          message: message.trim(),
        };
      }
      // Context/suggestion lines (indented)
      else if (currentError && line.match(/^\s{2,}/) && line.trim().length > 0) {
        contextLines.push(line.trim());
      }
      // Empty line marks end of error block
      else if (currentError && line.trim().length === 0) {
        errors.push(this.finalizeError(currentError, contextLines));
        currentError = null;
        contextLines = [];
      }
      
      // Stop if we've reached max errors
      if (errors.length >= (this.options.maxErrors || 100)) {
        break;
      }
    }
    
    // Don't forget last error
    if (currentError) {
      errors.push(this.finalizeError(currentError, contextLines));
    }
    
    // Filter warnings if not included
    const filtered = this.options.includeWarnings 
      ? errors 
      : errors.filter(e => e.severity === 'error');
    
    return filtered.length > 0 ? filtered : this.fallbackParse(output);
  }
  
  private finalizeError(
    partial: Partial<ParsedError>, 
    context: string[]
  ): ParsedError {
    const error: ParsedError = {
      raw: partial.raw || '',
      severity: partial.severity || 'error',
      message: partial.message || 'Unknown TypeScript error',
      file: partial.file,
      line: partial.line,
      column: partial.column,
      code: partial.code,
      context: context.length > 0 ? context : undefined,
      suggestion: this.getSuggestion(partial.code, partial.message)
    };
    
    return error;
  }
  
  private getSuggestion(code?: string, message?: string): string | undefined {
    if (!code || !message) return undefined;
    
    // Common TypeScript errors with suggestions
    const suggestions: Record<string, string> = {
      'TS2304': 'Import the missing type/module or check for typos',
      'TS2305': 'Check module exports and import statement',
      'TS2307': 'Install missing package or fix import path',
      'TS2345': 'Fix type mismatch - check function signature',
      'TS2339': 'Property does not exist - check type definition',
      'TS2740': 'Missing required properties - check object structure',
      'TS2322': 'Type assignment error - verify types match',
      'TS2571': 'Object type may be undefined - add null check',
    };
    
    return suggestions[code];
  }
  
  private fallbackParse(output: string): ParsedError[] {
    // If no structured errors found, return raw output as single error
    if (output.trim().length === 0) return [];
    
    return [{
      raw: output,
      severity: 'error',
      message: 'TypeScript compilation failed (unable to parse specific errors)',
      context: output.split('\n').slice(0, 10)
    }];
  }
}
