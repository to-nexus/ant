import * as fs from 'fs';
import * as path from 'path';
import { ValidationResult } from '../types';

/**
 * VueValidator
 * 
 * Validates Vue (Vite) projects for native base path configuration.
 * 
 * All frameworks now use native base path via environment variables:
 * - Vite: `base: process.env.VITE_BASE_PATH || '/'` in vite.config
 * - Vue Router: `createWebHistory(import.meta.env.VITE_BASE_PATH || '/')`
 * 
 * The proxy no longer injects `window.__BASENAME__` or rewrites HTML.
 */
export class VueValidator {
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
   * Validate Vue project for base path configuration
   */
  async validate(codebasePath: string): Promise<ValidationResult> {
    // Check Vite base config
    const hasViteBase = await this.hasViteBaseConfig(codebasePath);
    
    // Check Vue Router base config
    let hasRouterBase = false;
    const srcPath = path.join(codebasePath, 'src');
    const possibleFiles = ['main.ts', 'main.js', 'router/index.ts', 'router/index.js', 'router.ts', 'router.js'];
    
    for (const file of possibleFiles) {
      const filePath = path.join(srcPath, file);
      if (!fs.existsSync(filePath)) continue;
      
      try {
        const content = await fs.promises.readFile(filePath, 'utf-8');
        
        // Check for createWebHistory reading from env var
        if (content.includes('createWebHistory') &&
            (content.includes('VITE_BASE_PATH') || content.includes('ANT_BASE_PATH') ||
             content.includes('__BASENAME__'))) {  // legacy compat
          hasRouterBase = true;
          break;
        }
      } catch {
        // Skip file if read fails
      }
    }
    
    if (!hasViteBase || !hasRouterBase) {
      return {
        valid: false,
        framework: 'vue',
        reasoning: 'basepath-missing',
        reason: 'Missing base path configuration for dev server proxy',
        suggestedFix: this.buildSuggestedFix(!hasViteBase, !hasRouterBase),
      };
    }
    
    return { valid: true, framework: 'vue' };
  }
  
  private buildSuggestedFix(missingViteBase: boolean, missingRouterBase: boolean): string {
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
    
    if (missingRouterBase) {
      lines.push(
        `${missingViteBase ? '2' : '1'}. Add base to Vue Router:`,
        '',
        '```ts',
        '// src/router/index.ts',
        'const router = createRouter({',
        '  history: createWebHistory(import.meta.env.VITE_BASE_PATH || \'/\'),',
        '  routes,',
        '})',
        '```',
        '',
      );
    }
    
    lines.push(
      'The `VITE_BASE_PATH` environment variable is injected automatically by the Ant platform.',
      'When running outside Ant, it defaults to \'/\' (no prefix).',
    );
    
    return lines.join('\n');
  }
}
