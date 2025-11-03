/**
 * Vite Build Error Parser
 * 
 * Parses output from:
 * - vite build
 * - vite (dev server errors)
 */

import { BaseErrorParser, ParsedError, ErrorParserOptions } from './base';

export class ViteErrorParser extends BaseErrorParser {
  constructor(options: ErrorParserOptions = {}) {
    super(options);
  }
  
  parse(output: string): ParsedError[] {
    const errors: ParsedError[] = [];
    
    // 1. Entry module errors
    const entryErrors = this.parseEntryErrors(output);
    errors.push(...entryErrors);
    
    // 2. Plugin errors (e.g., [plugin:vite:resolve])
    const pluginErrors = this.parsePluginErrors(output);
    errors.push(...pluginErrors);
    
    // 3. Module resolution errors
    const moduleErrors = this.parseModuleErrors(output);
    errors.push(...moduleErrors);
    
    // 4. Import errors
    const importErrors = this.parseImportErrors(output);
    errors.push(...importErrors);
    
    // 5. Generic Vite errors
    const genericErrors = this.parseGenericErrors(output);
    errors.push(...genericErrors);
    
    return errors.slice(0, this.options.maxErrors || 100);
  }
  
  private parseEntryErrors(output: string): ParsedError[] {
    const errors: ParsedError[] = [];
    
    // Could not resolve entry module "index.html"
    const pattern = /Could not resolve entry module ["'](.+?)["']/gi;
    const matches = this.extractMatches(output, pattern);
    
    for (const match of matches) {
      const missingFile = match[1];
      const isHtml = missingFile.includes('.html');
      
      errors.push({
        raw: match[0],
        severity: 'error',
        code: 'VITE_ENTRY',
        message: `Missing entry file: ${missingFile}`,
        file: missingFile,
        suggestion: isHtml 
          ? 'Create index.html in project root with proper HTML structure'
          : `Create the missing entry file: ${missingFile}`,
        context: isHtml ? [
          'Vite requires index.html as entry point',
          'Example structure:',
          '  <!DOCTYPE html>',
          '  <html><head><title>App</title></head>',
          '  <body><div id="root"></div>',
          '  <script type="module" src="/src/main.tsx"></script>',
          '  </body></html>'
        ] : undefined
      });
    }
    
    return errors;
  }
  
  private parsePluginErrors(output: string): ParsedError[] {
    const errors: ParsedError[] = [];
    
    // [plugin:vite:resolve] Module "path" has been externalized...
    const pattern = /\[plugin:([^\]]+)\]\s+(.+?)(?:\n|$)/gi;
    const matches = this.extractMatches(output, pattern);
    
    for (const match of matches) {
      const plugin = match[1];
      const message = match[2];
      
      // Extract file path if present
      const fileMatch = message.match(/["']([^"']+?)["']/);
      const file = fileMatch ? fileMatch[1] : undefined;
      
      errors.push({
        raw: match[0],
        severity: 'error',
        code: `VITE_PLUGIN_${plugin.toUpperCase().replace(/[:-]/g, '_')}`,
        message: message.trim(),
        file,
        suggestion: this.getPluginSuggestion(plugin, message)
      });
    }
    
    return errors;
  }
  
  private parseModuleErrors(output: string): ParsedError[] {
    const errors: ParsedError[] = [];
    
    // Cannot find module './xyz' or its corresponding type declarations
    const pattern = /Cannot find module ["']([^"']+)["'].*?(?:type declarations)?/gi;
    const matches = this.extractMatches(output, pattern);
    
    const seen = new Set<string>();
    
    for (const match of matches) {
      const module = match[1];
      
      // Avoid duplicates
      if (seen.has(module)) continue;
      seen.add(module);
      
      const isRelative = module.startsWith('./') || module.startsWith('../');
      const isNodeModule = !isRelative && !module.startsWith('/');
      
      errors.push({
        raw: match[0],
        severity: 'error',
        code: 'MODULE_NOT_FOUND',
        message: `Cannot find module: ${module}`,
        suggestion: isNodeModule
          ? `Install package: npm install ${module}`
          : `Create missing file: ${module}`,
        context: isNodeModule ? [
          'This is a package dependency',
          `Run: npm install ${module}`
        ] : [
          'This is a local file import',
          `Create the file or fix the import path`
        ]
      });
    }
    
    return errors;
  }
  
  private parseImportErrors(output: string): ParsedError[] {
    const errors: ParsedError[] = [];
    
    // Failed to resolve import "./Component" from "src/App.tsx"
    const pattern = /[Ff]ailed to resolve import ["']([^"']+)["'](?: from ["']([^"']+)["'])?/gi;
    const matches = this.extractMatches(output, pattern);
    
    for (const match of matches) {
      const importPath = match[1];
      const fromFile = match[2];
      
      errors.push({
        raw: match[0],
        severity: 'error',
        code: 'IMPORT_RESOLVE_FAIL',
        message: `Failed to resolve import: ${importPath}`,
        file: fromFile,
        suggestion: 'Check import path and file extension (.tsx, .ts, .js)',
        context: fromFile ? [
          `Imported from: ${fromFile}`,
          'Common fixes:',
          '  - Add file extension: ./Component → ./Component.tsx',
          '  - Fix path: ./components/Button → ../components/Button',
          '  - Install package if external'
        ] : undefined
      });
    }
    
    return errors;
  }
  
  private parseGenericErrors(output: string): ParsedError[] {
    const errors: ParsedError[] = [];
    
    // Generic [vite] error messages
    const pattern = /\[vite\]\s+(.+?)(?:\n\n|\n$|$)/gi;
    const matches = this.extractMatches(output, pattern);
    
    for (const match of matches) {
      const message = match[1].trim();
      
      // Skip if already captured by specific parsers
      if (message.includes('Could not resolve entry') ||
          message.includes('[plugin:') ||
          message.includes('Failed to resolve import')) {
        continue;
      }
      
      errors.push({
        raw: match[0],
        severity: 'error',
        code: 'VITE_ERROR',
        message: message
      });
    }
    
    return errors;
  }
  
  private getPluginSuggestion(plugin: string, message: string): string | undefined {
    if (plugin.includes('resolve')) {
      if (message.includes('externalized for browser')) {
        return 'Remove Node.js module imports from browser code or use Electron/Tauri';
      }
      return 'Check module resolution and import paths';
    }
    
    if (plugin.includes('react')) {
      return 'Check React component syntax and JSX configuration';
    }
    
    return undefined;
  }
}
