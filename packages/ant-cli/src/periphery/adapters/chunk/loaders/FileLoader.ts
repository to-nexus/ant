import * as fs from "fs/promises";
import * as path from "path";
import { Loader } from "../../../../core/chunk/pipeline";
import { ChunkInput, LoadedContent } from "../../../../core/chunk/types";

/**
 * FileLoader - Load content from file system
 */
export class FileLoader implements Loader {
  async load(input: ChunkInput): Promise<LoadedContent> {
    const filePath = input.source;
    
    // Read file
    const text = await fs.readFile(filePath, 'utf-8');
    
    // Detect content type from extension
    const ext = path.extname(filePath).toLowerCase();
    const contentType = this.detectContentType(ext, text);
    
    // Update metadata with file info
    const metadata = {
      ...input.metadata,
      filePath,
      language: this.detectLanguage(ext)
    };
    
    return {
      text,
      contentType,
      metadata
    };
  }
  
  supports(sourceType: string): boolean {
    return sourceType === 'file';
  }
  
  /**
   * Detect content type from file extension
   */
  private detectContentType(
    ext: string,
    text: string
  ): 'markdown' | 'code' | 'plain' {
    if (ext === '.md' || ext === '.markdown') {
      return 'markdown';
    }
    
    const codeExtensions = [
      '.ts', '.tsx', '.js', '.jsx', 
      '.py', '.go', '.rs', '.java', 
      '.c', '.cpp', '.h', '.hpp'
    ];
    
    if (codeExtensions.includes(ext)) {
      return 'code';
    }
    
    // Fallback: check content
    if (text.match(/^#{1,6}\s+/m)) {
      return 'markdown';
    }
    
    return 'plain';
  }
  
  /**
   * Detect programming language from extension
   */
  private detectLanguage(ext: string): string | undefined {
    const langMap: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.py': 'python',
      '.go': 'go',
      '.rs': 'rust',
      '.java': 'java',
      '.c': 'c',
      '.cpp': 'cpp'
    };
    
    return langMap[ext];
  }
}

