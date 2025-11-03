/**
 * Error Parser Factory
 * 
 * Creates appropriate parser based on tool/language
 */

import { BaseErrorParser, ErrorParserOptions } from './base';
import { TypeScriptErrorParser } from './typescript';
import { ViteErrorParser } from './vite';
import { ESLintErrorParser } from './eslint';

export type ParserType = 'typescript' | 'vite' | 'eslint' | 'webpack' | 'rollup' | 'generic';

export class ErrorParserFactory {
  /**
   * Create parser for specific tool
   */
  static create(type: ParserType, options?: ErrorParserOptions): BaseErrorParser {
    switch (type) {
      case 'typescript':
        return new TypeScriptErrorParser(options);
      
      case 'vite':
        return new ViteErrorParser(options);
      
      case 'eslint':
        return new ESLintErrorParser(options);
      
      case 'webpack':
      case 'rollup':
      case 'generic':
      default:
        // TODO: Implement webpack, rollup parsers
        return new GenericErrorParser(options);
    }
  }
  
  /**
   * Auto-detect parser type from output
   */
  static detect(output: string): ParserType {
    const lower = output.toLowerCase();
    
    // TypeScript
    if (lower.includes('error ts') || lower.includes('tsc --noemit')) {
      return 'typescript';
    }
    
    // Vite
    if (lower.includes('[vite]') || lower.includes('vite build')) {
      return 'vite';
    }
    
    // ESLint
    if (lower.includes('eslint') || /\d+:\d+\s+(error|warning)/.test(output)) {
      return 'eslint';
    }
    
    // Webpack
    if (lower.includes('webpack') || lower.includes('compilation failed')) {
      return 'webpack';
    }
    
    // Rollup
    if (lower.includes('rollup')) {
      return 'rollup';
    }
    
    return 'generic';
  }
  
  /**
   * Parse with auto-detection
   */
  static parse(output: string, options?: ErrorParserOptions) {
    const type = this.detect(output);
    const parser = this.create(type, options);
    return parser.parse(output);
  }
}

/**
 * Generic fallback parser
 */
class GenericErrorParser extends BaseErrorParser {
  parse(output: string) {
    // Simple line-by-line parsing
    const errors = [];
    const lines = output.split('\n');
    
    for (const line of lines) {
      if (line.toLowerCase().includes('error') && line.trim().length > 0) {
        errors.push({
          raw: line,
          severity: 'error' as const,
          message: line.trim()
        });
      }
    }
    
    return errors.length > 0 ? errors : [{
      raw: output,
      severity: 'error' as const,
      message: 'Build failed (unable to parse specific errors)',
      context: output.split('\n').slice(0, 10)
    }];
  }
}

// Re-export types and classes
export { BaseErrorParser, TypeScriptErrorParser, ViteErrorParser, ESLintErrorParser };
export type { ParsedError, ErrorParserOptions } from './base';
