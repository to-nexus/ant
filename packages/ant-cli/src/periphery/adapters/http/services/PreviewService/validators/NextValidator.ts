import * as fs from 'fs';
import * as path from 'path';
import { ValidationResult } from '../types';

/**
 * NextValidator
 * 
 * Validates Next.js projects for basePath configuration.
 * 
 * Next.js serves all assets (images, CSS, JS) and routes with the basePath prefix
 * at the framework level — both during SSR and CSR. Without basePath, the preview proxy's
 * post-render HTML rewriting causes hydration mismatches:
 *   Server: "/serverKey/logos/logo.svg"  (proxy-rewritten)
 *   Client: "/logos/logo.svg"            (React bundle, un-prefixed)
 * 
 * Unlike CSR-only frameworks (React Router) that use window.__BASENAME__,
 * Next.js requires `basePath` in next.config to avoid SSR hydration issues.
 */
export class NextValidator {
  private readonly configCandidates = [
    'next.config.js',
    'next.config.mjs',
    'next.config.ts',
  ];
  
  /**
   * Find the next.config file in the project
   */
  private findConfigFile(codebasePath: string): string | null {
    for (const candidate of this.configCandidates) {
      const fullPath = path.join(codebasePath, candidate);
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }
    return null;
  }
  
  /**
   * Check if the config file contains basePath configuration
   */
  private hasBasePathConfig(content: string): boolean {
    // Match basePath as an object property: basePath: or basePath =
    // Also match quoted variants: "basePath": or 'basePath':
    return (
      /basePath\s*[:=]/.test(content) ||
      /["']basePath["']\s*[:=]/.test(content)
    );
  }
  
  /**
   * Check if the config reads NEXT_PUBLIC_BASE_PATH from environment
   */
  private readsEnvBasePath(content: string): boolean {
    return content.includes('NEXT_PUBLIC_BASE_PATH');
  }
  
  /**
   * Validate Next.js project for basePath configuration
   */
  async validate(codebasePath: string): Promise<ValidationResult> {
    const configPath = this.findConfigFile(codebasePath);
    
    // No config file at all — suggest creating one with basePath
    if (!configPath) {
      return {
        valid: false,
        framework: 'next',
        reasoning: 'basepath-missing',
        reason: 'Missing basePath in Next.js config for dev server proxy',
        missingFiles: ['next.config.js (or next.config.mjs / next.config.ts)'],
        suggestedFix: this.buildSuggestedFix(false),
      };
    }
    
    try {
      const content = await fs.promises.readFile(configPath, 'utf-8');
      
      if (this.hasBasePathConfig(content)) {
        // basePath is present — valid
        return { valid: true, framework: 'next' };
      }
      
      // Config exists but no basePath
      return {
        valid: false,
        framework: 'next',
        reasoning: 'basepath-missing',
        reason: 'Missing basePath in Next.js config for dev server proxy',
        missingFiles: [path.basename(configPath)],
        suggestedFix: this.buildSuggestedFix(true),
      };
    } catch {
      // Can't read config — don't block
      return { valid: true, framework: 'next' };
    }
  }
  
  /**
   * Build LLM-ready suggested fix instruction
   */
  private buildSuggestedFix(configExists: boolean): string {
    const lines: string[] = [
      'This preview server runs in the Ant platform\'s proxy environment (/:serverKey/).',
      '',
      'Next.js requires `basePath` in its config so that ALL URLs (routes, assets, images)',
      'are generated with the correct prefix — both during server-side rendering and client-side hydration.',
      'Without this, SSR hydration mismatches will occur.',
      '',
    ];
    
    if (configExists) {
      lines.push(
        'Please add `basePath` and `images` to the existing Next.js config file:',
      );
    } else {
      lines.push(
        'Please create a `next.config.js` (or .mjs/.ts) with `basePath` and `images`:',
      );
    }
    
    lines.push(
      '',
      '```js',
      '// next.config.js',
      'const nextConfig = {',
      '  basePath: process.env.NEXT_PUBLIC_BASE_PATH || \'\',',
      '  images: {',
      '    unoptimized: !!process.env.NEXT_PUBLIC_BASE_PATH,',
      '  },',
      '  // ... other config',
      '};',
      '',
      'module.exports = nextConfig;',
      '```',
      '',
      'The environment variable `NEXT_PUBLIC_BASE_PATH` is injected automatically by the Ant platform at runtime.',
      'When running outside Ant, it defaults to empty string (no prefix), so the app works normally.',
      '',
      '`images.unoptimized` disables Next.js Image Optimization when running in the proxy environment.',
      'This avoids internal fetch issues with the proxy path prefix while keeping optimization active in production.',
    );
    
    return lines.join('\n');
  }
}
