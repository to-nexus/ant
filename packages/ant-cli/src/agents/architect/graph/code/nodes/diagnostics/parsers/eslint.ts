/**
 * ESLint Error Parser
 * 
 * Parses output from:
 * - eslint
 * - eslint --format stylish (default)
 */

import { BaseErrorParser, ParsedError, ErrorParserOptions } from './base';

export class ESLintErrorParser extends BaseErrorParser {
  constructor(options: ErrorParserOptions = {}) {
    super(options);
  }
  
  parse(output: string): ParsedError[] {
    // Check if eslint is missing
    if (this.isToolMissing(output, [
      'command not found: eslint',
      'eslint: command not found',
      'No ESLint configuration found'
    ])) {
      return [{
        raw: output,
        severity: 'warning',
        message: 'ESLint is not installed or configured',
        suggestion: 'Run: npm install --save-dev eslint'
      }];
    }
    
    const errors: ParsedError[] = [];
    const lines = output.split('\n');
    
    let currentFile: string | undefined;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // File path line (usually starts with /, ./, or no indent)
      // Example: /Users/probe/dev/ant/src/App.tsx
      const fileMatch = line.match(/^([\/\w][\w\/\-\.]+\.(?:tsx?|jsx?))$/);
      if (fileMatch) {
        currentFile = fileMatch[1];
        continue;
      }
      
      // Error line format (stylish):
      //   10:5  error  'React' is not defined  no-undef
      const errorMatch = line.match(/^\s+(\d+):(\d+)\s+(error|warning)\s+(.+?)\s+([\w\/-]+)$/);
      
      if (errorMatch && currentFile) {
        const [, lineNum, col, severity, message, rule] = errorMatch;
        
        errors.push({
          raw: line.trim(),
          file: currentFile,
          line: parseInt(lineNum, 10),
          column: parseInt(col, 10),
          severity: severity as 'error' | 'warning',
          code: rule,
          message: message.trim(),
          suggestion: this.getRuleSuggestion(rule)
        });
        
        // Stop if max errors reached
        if (errors.length >= (this.options.maxErrors || 100)) {
          break;
        }
      }
    }
    
    // Filter warnings if not included
    const filtered = this.options.includeWarnings 
      ? errors 
      : errors.filter(e => e.severity === 'error');
    
    return filtered;
  }
  
  private getRuleSuggestion(rule: string): string | undefined {
    const suggestions: Record<string, string> = {
      'no-undef': 'Import the undefined variable or add to globals',
      'no-unused-vars': 'Remove unused variable or prefix with underscore',
      '@typescript-eslint/no-unused-vars': 'Remove unused variable or prefix with underscore',
      'import/no-unresolved': 'Check import path or install missing package',
      'react/prop-types': 'Add PropTypes or use TypeScript',
      'react-hooks/exhaustive-deps': 'Add missing dependency or disable if intentional',
      'no-console': 'Remove console.log or use proper logging',
    };
    
    return suggestions[rule];
  }
}
