/**
 * Figma File Reader
 * 
 * Reads inputs/figma.md and extracts Figma file URLs
 */

import * as fs from 'fs';
import * as path from 'path';

export interface FigmaFileReference {
  fileKey: string;
  nodeName?: string;
  url: string;
  description?: string;
}

export class FigmaFileReader {
  /**
   * Read figma.md and extract Figma file URLs
   * 
   * Supports formats:
   * - https://www.figma.com/file/{fileKey}/{fileName}
   * - https://www.figma.com/design/{fileKey}/{fileName}
   * - https://www.figma.com/file/{fileKey}/{fileName}?node-id={nodeId}
   */
  static readFigmaReferences(featurePath: string): FigmaFileReference[] {
    const figmaInputPath = path.join(featurePath, 'inputs', 'figma.md');
    
    if (!fs.existsSync(figmaInputPath)) {
      return [];
    }
    
    const content = fs.readFileSync(figmaInputPath, 'utf-8');
    const references: FigmaFileReference[] = [];
    
    // Extract Figma URLs
    const figmaUrlRegex = /https:\/\/(?:www\.)?figma\.com\/(?:file|design)\/([a-zA-Z0-9]+)/g;
    const lines = content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const matches = [...line.matchAll(figmaUrlRegex)];
      
      for (const match of matches) {
        const url = match[0];
        const fileKey = match[1];
        
        // Extract node ID if present
        const nodeMatch = url.match(/node-id=([^&\s]+)/);
        const nodeName = nodeMatch ? nodeMatch[1] : undefined;
        
        // Try to get description from previous or next line
        let description: string | undefined;
        if (i > 0 && lines[i - 1].trim().startsWith('#')) {
          description = lines[i - 1].replace(/^#+\s*/, '').trim();
        }
        
        references.push({
          fileKey,
          nodeName,
          url,
          description
        });
      }
    }
    
    return references;
  }
  
  /**
   * Create example figma.md file
   */
  static createExampleFile(featurePath: string): void {
    const inputsDir = path.join(featurePath, 'inputs');
    const figmaPath = path.join(inputsDir, 'figma.md');
    
    if (fs.existsSync(figmaPath)) {
      return; // Don't overwrite existing file
    }
    
    if (!fs.existsSync(inputsDir)) {
      fs.mkdirSync(inputsDir, { recursive: true });
    }
    
    const exampleContent = `# Figma Design References

Add Figma file URLs here to guide the code generation process.

## Login Page
https://www.figma.com/file/abc123/Login-Page-Design

## Dashboard
https://www.figma.com/design/xyz789/Dashboard-Design?node-id=1-2

## Component Library
https://www.figma.com/file/def456/Component-Library

---

**Format:**
- Full Figma file URLs
- Optional: Include node-id to focus on specific components
- Add headings to describe what each design represents
`;
    
    fs.writeFileSync(figmaPath, exampleContent, 'utf-8');
  }
}
