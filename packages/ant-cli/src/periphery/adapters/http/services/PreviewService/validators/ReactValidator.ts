import * as fs from 'fs';
import * as path from 'path';
import { ValidationResult } from '../types';

/**
 * ReactValidator
 * 
 * Validates React (Vite) projects for native base path configuration.
 * 
 * All frameworks now use native base path via environment variables:
 * - Vite: `base: process.env.VITE_BASE_PATH || '/'` in vite.config
 * - React Router: `basename={import.meta.env.VITE_BASE_PATH || ''}`
 * 
 * The proxy no longer injects `window.__BASENAME__` or rewrites HTML.
 */
export class ReactValidator {
  private maxFilesToScan = 250;
  private maxFileSizeBytes = 512 * 1024; // 512KB
  
  private async usesReactRouter(codebasePath: string): Promise<boolean> {
    // Always verify actual usage in source code — package.json alone is not enough
    // because the dependency may be listed but never imported (e.g., LLM added it speculatively).
    const srcPath = path.join(codebasePath, 'src');
    if (!fs.existsSync(srcPath)) return false;
    
    try {
      const files = await this.collectSourceFiles(srcPath);
      for (const filePath of files) {
        try {
          const stat = await fs.promises.stat(filePath);
          if (stat.size > this.maxFileSizeBytes) continue;
          const content = await fs.promises.readFile(filePath, 'utf-8');
          if (
            content.includes('react-router-dom') ||
            content.includes('BrowserRouter') ||
            content.includes('createBrowserRouter') ||
            content.includes('RouterProvider') ||
            content.includes('<Routes') ||
            content.includes('<Route')
          ) {
            return true;
          }
        } catch {
          // skip
        }
      }
    } catch {
      // ignore
    }
    
    return false;
  }

  private async collectSourceFiles(dir: string): Promise<string[]> {
    const result: string[] = [];
    const stack: string[] = [dir];
    
    while (stack.length > 0 && result.length < this.maxFilesToScan) {
      const current = stack.pop()!;
      let entries: fs.Dirent[] = [];
      
      try {
        entries = await fs.promises.readdir(current, { withFileTypes: true });
      } catch {
        continue;
      }
      
      for (const entry of entries) {
        if (result.length >= this.maxFilesToScan) break;
        if (entry.name.startsWith('.')) continue;
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build') continue;
        
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
          continue;
        }
        
        if (!/\.(tsx|ts|jsx|js)$/.test(entry.name)) continue;
        result.push(full);
      }
    }
    
    return result;
  }
  
  /**
   * Check if vite.config reads VITE_BASE_PATH for base
   */
  private async hasViteBaseConfig(codebasePath: string): Promise<boolean> {
    const candidates = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs'];
    for (const candidate of candidates) {
      const configPath = path.join(codebasePath, candidate);
      if (!fs.existsSync(configPath)) continue;
      try {
        const content = await fs.promises.readFile(configPath, 'utf-8');
        // Check for `base:` config that reads VITE_BASE_PATH
        if (content.includes('VITE_BASE_PATH') && /base\s*[:=]/.test(content)) {
          return true;
        }
      } catch {
        // skip
      }
    }
    return false;
  }
  
  /**
   * Check if router uses basename from VITE_BASE_PATH env
   */
  private hasRouterEnvBasename(content: string): boolean {
    // Check for basename reading from import.meta.env.VITE_BASE_PATH or ANT_BASE_PATH
    return (
      (content.includes('basename') &&
       (content.includes('VITE_BASE_PATH') || content.includes('ANT_BASE_PATH')))
    );
  }
  
  
  /**
   * Validate React project for base path configuration
   */
  async validate(codebasePath: string): Promise<ValidationResult> {
    // If the project does not use React Router, basename configuration is NOT required
    const hasRouter = await this.usesReactRouter(codebasePath);
    if (!hasRouter) {
      // Still check for Vite base config (needed for asset paths even without router)
      const hasViteBase = await this.hasViteBaseConfig(codebasePath);
      if (!hasViteBase) {
        return {
          valid: false,
          framework: 'react',
          reasoning: 'basename-missing',
          reason: 'Missing Vite base path configuration for dev server proxy',
          suggestedFix: this.buildViteBaseSuggestedFix(),
        };
      }
      return { valid: true, framework: 'react' };
    }

    // Check Vite base config
    const hasViteBase = await this.hasViteBaseConfig(codebasePath);
    
    // Check router basename config
    let hasBasenameConfig = false;
    const srcPath = path.join(codebasePath, 'src');
    if (fs.existsSync(srcPath)) {
      const files = await this.collectSourceFiles(srcPath);
      for (const filePath of files) {
        try {
          const stat = await fs.promises.stat(filePath);
          if (stat.size > this.maxFileSizeBytes) continue;
          const content = await fs.promises.readFile(filePath, 'utf-8');
          if (this.hasRouterEnvBasename(content)) {
            hasBasenameConfig = true;
            break;
          }
        } catch {
          // skip
        }
      }
    }
    
    if (!hasViteBase || !hasBasenameConfig) {
      return {
        valid: false,
        framework: 'react',
        reasoning: 'basename-missing',
        reason: 'Missing base path configuration for dev server proxy',
        suggestedFix: this.buildFullSuggestedFix(!hasViteBase, !hasBasenameConfig),
      };
    }
    
    return { valid: true, framework: 'react' };
  }
  
  private buildViteBaseSuggestedFix(): string {
    return [
      'This preview server runs in the Ant platform\'s proxy environment (/:urlKey/).',
      '',
      'Please add `base` to your Vite config so all asset paths include the proxy prefix:',
      '',
      '```js',
      '// vite.config.ts',
      'export default defineConfig({',
      '  base: process.env.VITE_BASE_PATH || \'/\',',
      '  // ... other config',
      '})',
      '```',
      '',
      'The `VITE_BASE_PATH` environment variable is injected automatically by the Ant platform.',
      'When running outside Ant, it defaults to \'/\' (no prefix).',
    ].join('\n');
  }
  
  private buildFullSuggestedFix(missingViteBase: boolean, missingRouterBasename: boolean): string {
    const lines: string[] = [
      'This preview server runs in the Ant platform\'s proxy environment (/:urlKey/).',
      '',
    ];
    
    if (missingViteBase) {
      lines.push(
        '1. Add `base` to your Vite config:',
        '',
        '```js',
        '// vite.config.ts',
        'export default defineConfig({',
        '  base: process.env.VITE_BASE_PATH || \'/\',',
        '})',
        '```',
        '',
      );
    }
    
    if (missingRouterBasename) {
      lines.push(
        `${missingViteBase ? '2' : '1'}. Add basename to your React Router:`,
        '',
        '```tsx',
        '// Router setup',
        '<BrowserRouter basename={import.meta.env.VITE_BASE_PATH || \'\'}>',
        '  {/* routes */}',
        '</BrowserRouter>',
        '```',
        '',
        'Or for data router (v6.4+):',
        '```tsx',
        'const router = createBrowserRouter(routes, {',
        '  basename: import.meta.env.VITE_BASE_PATH || \'\'',
        '});',
        '```',
        '',
      );
    }
    
    lines.push(
      'The `VITE_BASE_PATH` environment variable is injected automatically by the Ant platform.',
      'When running outside Ant, it defaults to empty/\'/\' (no prefix).',
    );
    
    return lines.join('\n');
  }
}
