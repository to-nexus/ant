import * as fs from 'fs';
import * as path from 'path';
import { ValidationResult } from '../types';

/**
 * VueValidator
 * 
 * Validates Vue projects for dev server basename configuration
 */
export class VueValidator {
  /**
   * Validate Vue project for basename configuration
   */
  async validate(codebasePath: string): Promise<ValidationResult> {
    const srcPath = path.join(codebasePath, 'src');
    const possibleFiles = ['main.ts', 'main.js', 'router/index.ts', 'router/index.js'];
    
    let hasBasenameConfig = false;
    
    for (const file of possibleFiles) {
      const filePath = path.join(srcPath, file);
      if (!fs.existsSync(filePath)) continue;
      
      try {
        const content = await fs.promises.readFile(filePath, 'utf-8');
        
        // Check for createWebHistory with __BASENAME__
        if (content.includes('createWebHistory') && 
            content.includes('__BASENAME__')) {
          hasBasenameConfig = true;
          break;
        }
      } catch (error) {
        // Skip file if read fails
      }
    }
    
    if (!hasBasenameConfig) {
      return {
        valid: false,
        framework: 'vue',
        reasoning: 'basename-missing',
        reason: 'Missing basename configuration for dev server proxy',
        missingFiles: ['src/main.ts or src/router/index.ts'],
        suggestedFix: `This preview server runs in Ant platform's proxy environment (/preview/:serverKey/).

Please add basename configuration for Vue Router to recognize the proxy path.`.trim()
      };
    }
    
    return { valid: true, framework: 'vue' };
  }
}

