import * as fs from 'fs';
import * as path from 'path';
import { ValidationResult } from '../types';

/**
 * ReactValidator
 * 
 * Validates React projects for dev server basename configuration
 */
export class ReactValidator {
  private maxFilesToScan = 250;
  private maxFileSizeBytes = 512 * 1024; // 512KB
  
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
  
  private hasRouterBasenameConfig(content: string): boolean {
    // BrowserRouter basename prop
    const browserRouterBasename =
      content.includes('<BrowserRouter') &&
      (content.includes('basename=') || content.includes('basename ='));
    
    // Data router basename option (react-router-dom v6.4+)
    const dataRouterBasename =
      content.includes('createBrowserRouter') &&
      (content.includes('basename:') || content.includes('basename :'));
    
    return browserRouterBasename || dataRouterBasename;
  }
  
  private hasWindowBasenameUsage(content: string): boolean {
    return content.includes('window.__BASENAME__');
  }
  
  private hasWindowBasenameType(content: string): boolean {
    return (
      (content.includes('interface Window') || content.includes('declare global')) &&
      content.includes('__BASENAME__')
    );
  }
  
  /**
   * Validate React project for basename configuration
   */
  async validate(codebasePath: string): Promise<ValidationResult> {
    const srcPath = path.join(codebasePath, 'src');
    const possibleFiles = ['App.tsx', 'App.jsx', 'main.tsx', 'main.jsx', 'index.tsx', 'index.jsx'];
    const missingFiles: string[] = [];
    
    let hasBasenameConfig = false;
    let hasWindowType = false;
    let usesWindowBasename = false;
    
    for (const file of possibleFiles) {
      const filePath = path.join(srcPath, file);
      if (!fs.existsSync(filePath)) continue;
      
      try {
        const stat = await fs.promises.stat(filePath);
        if (stat.size > this.maxFileSizeBytes) continue;
        const content = await fs.promises.readFile(filePath, 'utf-8');
        
        // Check for basename configuration (prefer fast-path on common entry files)
        if (this.hasRouterBasenameConfig(content)) {
          hasBasenameConfig = true;
        }
        
        if (this.hasWindowBasenameUsage(content)) {
          usesWindowBasename = true;
        }
        
        // Check for Window type declaration (may live outside entry files)
        if (this.hasWindowBasenameType(content)) {
          hasWindowType = true;
        }
      } catch (error) {
        // Skip file if read fails
      }
    }
    
    // ✅ If not found in typical entry files, scan src recursively.
    // Many projects place Router config under src/presentation/router.tsx etc.
    if (!hasBasenameConfig || !hasWindowType || !usesWindowBasename) {
      if (fs.existsSync(srcPath)) {
        const files = await this.collectSourceFiles(srcPath);
        
        for (const filePath of files) {
          try {
            const stat = await fs.promises.stat(filePath);
            if (stat.size > this.maxFileSizeBytes) continue;
            
            const content = await fs.promises.readFile(filePath, 'utf-8');
            
            if (!hasBasenameConfig && this.hasRouterBasenameConfig(content)) {
              hasBasenameConfig = true;
            }
            
            if (!usesWindowBasename && this.hasWindowBasenameUsage(content)) {
              usesWindowBasename = true;
            }
            
            if (!hasWindowType && this.hasWindowBasenameType(content)) {
              hasWindowType = true;
            }
            
            if (hasBasenameConfig && hasWindowType && usesWindowBasename) {
              break;
            }
          } catch {
            // Skip
          }
        }
      }
    }
    
    if (!hasBasenameConfig) {
      return {
        valid: false,
        framework: 'react',
        reasoning: 'basename-missing',
        reason: 'Missing basename configuration for dev server proxy',
        missingFiles: ['A router entry under src/ (e.g., App.tsx, main.tsx, presentation/router.tsx)'],
        suggestedFix: `This dev server runs in Ant platform's proxy environment (/dev/:serverKey/).

Please add basename configuration for React Router to recognize the proxy path.`.trim()
      };
    }
    
    // Only require Window type when the project actually reads window.__BASENAME__
    if (usesWindowBasename && !hasWindowType) {
      return {
        valid: false,
        framework: 'react',
        reasoning: 'basename-missing',
        reason: 'Missing Window.__BASENAME__ type declaration for dev server proxy',
        missingFiles: ['Any TS file under src/ (e.g., global.d.ts or router file)'],
        suggestedFix: `Please add type declaration for window.__BASENAME__ so TypeScript can recognize it.`.trim()
      };
    }
    
    return { valid: true, framework: 'react' };
  }
}

