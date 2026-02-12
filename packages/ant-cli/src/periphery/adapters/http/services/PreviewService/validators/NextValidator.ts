import * as fs from 'fs';
import * as path from 'path';
import { ValidationResult } from '../types';

/**
 * NextValidator
 * 
 * Validates Next.js projects for basePath configuration.
 * 
 * Next.js serves all assets (images, CSS, JS) and routes with the basePath prefix
 * at the framework level — both during SSR and CSR. Without basePath, the preview
 * proxy cannot route requests correctly because Next.js won't recognize the prefixed URLs.
 * 
 * Required configuration:
 * - `basePath: process.env.NEXT_PUBLIC_BASE_PATH || ''` in next.config
 * - `images: { unoptimized: !!process.env.NEXT_PUBLIC_BASE_PATH }` (recommended)
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
        suggestedFix: this.buildSuggestedFix(false, false),
      };
    }
    
    try {
      const content = await fs.promises.readFile(configPath, 'utf-8');
      
      const hasBasePath = this.hasBasePathConfig(content);
      const readsEnv = this.readsEnvBasePath(content);
      
      if (hasBasePath && readsEnv) {
        // basePath is present AND reads from NEXT_PUBLIC_BASE_PATH — valid
        return { valid: true, framework: 'next' };
      }
      
      if (hasBasePath && !readsEnv) {
        // basePath exists but is hardcoded (not from env var)
        return {
          valid: false,
          framework: 'next',
          reasoning: 'basepath-missing',
          reason: 'basePath in Next.js config must read from NEXT_PUBLIC_BASE_PATH environment variable',
          missingFiles: [path.basename(configPath)],
          suggestedFix: this.buildSuggestedFix(true, true),
        };
      }
      
      // Config exists but no basePath
      return {
        valid: false,
        framework: 'next',
        reasoning: 'basepath-missing',
        reason: 'Missing basePath in Next.js config for dev server proxy',
        missingFiles: [path.basename(configPath)],
        suggestedFix: this.buildSuggestedFix(true, false),
      };
    } catch {
      // Config file exists but can't be read — treat as invalid so the user is notified
      return {
        valid: false,
        framework: 'next',
        reasoning: 'basepath-missing',
        reason: 'Could not read Next.js config file to verify basePath configuration',
        suggestedFix: this.buildSuggestedFix(true, false),
      };
    }
  }
  
  /**
   * Build LLM-ready suggested fix instruction
   */
  private buildSuggestedFix(configExists: boolean, hasHardcodedBasePath: boolean): string {
    const lines: string[] = [
      'This preview server runs in the Ant platform\'s proxy environment (/:urlKey/).',
      '',
      'Next.js requires `basePath` in its config so that ALL URLs (routes, assets, images)',
      'are generated with the correct prefix — both during server-side rendering and client-side hydration.',
      '',
    ];
    
    if (hasHardcodedBasePath) {
      lines.push(
        'The `basePath` in your config appears to be hardcoded. It must read from the',
        '`NEXT_PUBLIC_BASE_PATH` environment variable so the Ant platform can inject the correct value:',
      );
    } else if (configExists) {
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
