import * as fs from 'fs';
import * as path from 'path';
import { ValidationResult } from '../types';

/**
 * ReactValidator
 * 
 * Validates React projects for dev server basename configuration
 */
export class ReactValidator {
  /**
   * Validate React project for basename configuration
   */
  async validate(codebasePath: string): Promise<ValidationResult> {
    const srcPath = path.join(codebasePath, 'src');
    const possibleFiles = ['App.tsx', 'App.jsx', 'main.tsx', 'main.jsx', 'index.tsx', 'index.jsx'];
    const missingFiles: string[] = [];
    
    let hasBasenameConfig = false;
    let hasWindowType = false;
    
    for (const file of possibleFiles) {
      const filePath = path.join(srcPath, file);
      if (!fs.existsSync(filePath)) continue;
      
      try {
        const content = await fs.promises.readFile(filePath, 'utf-8');
        
        // Check for basename configuration
        if (content.includes('window.__BASENAME__') && 
            content.includes('<BrowserRouter') &&
            content.includes('basename=')) {
          hasBasenameConfig = true;
        }
        
        // Check for Window type declaration
        if (content.includes('interface Window') && 
            content.includes('__BASENAME__')) {
          hasWindowType = true;
        }
      } catch (error) {
        // Skip file if read fails
      }
    }
    
    if (!hasBasenameConfig) {
      return {
        valid: false,
        framework: 'react',
        reasoning: 'basename-missing',
        reason: 'Missing basename configuration for dev server proxy',
        missingFiles: ['App.tsx or App.jsx'],
        suggestedFix: `This dev server runs in Ant platform's proxy environment (/dev/:serverKey/).

Please add basename configuration for React Router to recognize the proxy path.`.trim()
      };
    }
    
    if (!hasWindowType) {
      return {
        valid: false,
        framework: 'react',
        reasoning: 'basename-missing',
        reason: 'Missing Window.__BASENAME__ type declaration for dev server proxy',
        missingFiles: ['App.tsx or global.d.ts'],
        suggestedFix: `Please add type declaration for window.__BASENAME__ so TypeScript can recognize it.`.trim()
      };
    }
    
    return { valid: true, framework: 'react' };
  }
}

