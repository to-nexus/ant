import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

/**
 * Import relationship
 */
export interface ImportRelation {
  importer: string;
  importee: string;
  type: 'static' | 'dynamic' | 'type-only';
}

/**
 * Import graph node
 */
export interface ImportNode {
  file: string;
  imports: string[];      // Files this file imports
  importedBy: string[];   // Files that import this file
}

/**
 * ImportGraphAnalyzer
 * 
 * Builds and analyzes import dependency graph
 * Helps find related files based on import relationships
 */
export class ImportGraphAnalyzer {
  private graph: Map<string, ImportNode> = new Map();
  
  /**
   * Build import graph for a directory
   */
  async buildGraph(rootDir: string, extensions: string[] = ['.ts', '.tsx', '.js', '.jsx']): Promise<void> {
    console.log('🔍 Building import graph...');
    
    const files = this.findSourceFiles(rootDir, extensions);
    
    // Parse each file and extract imports
    for (const file of files) {
      const imports = await this.extractImports(file, rootDir);
      
      this.graph.set(file, {
        file,
        imports,
        importedBy: []
      });
    }
    
    // Build reverse relationships (importedBy)
    for (const [file, node] of this.graph.entries()) {
      for (const imported of node.imports) {
        const importedNode = this.graph.get(imported);
        if (importedNode) {
          importedNode.importedBy.push(file);
        }
      }
    }
    
    console.log(`✅ Import graph built: ${this.graph.size} files`);
  }
  
  /**
   * Get all related files for a given set of files
   * Includes: direct imports, files that import these, transitive dependencies
   */
  getRelatedFiles(
    targetFiles: string[],
    options: {
      depth?: number;           // Max depth for transitive dependencies (default: 2)
      includeImporters?: boolean;  // Include files that import the targets (default: true)
      includeImportees?: boolean;  // Include files imported by targets (default: true)
    } = {}
  ): string[] {
    const depth = options.depth ?? 2;
    const includeImporters = options.includeImporters ?? true;
    const includeImportees = options.includeImportees ?? true;
    
    const related = new Set<string>();
    const visited = new Set<string>();
    
    // BFS to find related files
    const queue: Array<{ file: string; currentDepth: number; direction: 'up' | 'down' }> = [];
    
    for (const file of targetFiles) {
      related.add(file);
      if (includeImporters) queue.push({ file, currentDepth: 0, direction: 'up' });
      if (includeImportees) queue.push({ file, currentDepth: 0, direction: 'down' });
    }
    
    while (queue.length > 0) {
      const { file, currentDepth, direction } = queue.shift()!;
      
      if (currentDepth >= depth) continue;
      
      const visitKey = `${file}-${direction}-${currentDepth}`;
      if (visited.has(visitKey)) continue;
      visited.add(visitKey);
      
      const node = this.graph.get(file);
      if (!node) continue;
      
      if (direction === 'up') {
        // Files that import this file
        for (const importer of node.importedBy) {
          related.add(importer);
          queue.push({ file: importer, currentDepth: currentDepth + 1, direction: 'up' });
        }
      } else {
        // Files imported by this file
        for (const importee of node.imports) {
          related.add(importee);
          queue.push({ file: importee, currentDepth: currentDepth + 1, direction: 'down' });
        }
      }
    }
    
    return Array.from(related);
  }
  
  /**
   * Get files that would be affected if target files change
   */
  getAffectedFiles(changedFiles: string[]): string[] {
    return this.getRelatedFiles(changedFiles, {
      depth: 3,
      includeImporters: true,
      includeImportees: false  // Only care about who imports these
    });
  }
  
  /**
   * Extract imports from a TypeScript/JavaScript file
   */
  private async extractImports(filePath: string, rootDir: string): Promise<string[]> {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const imports: string[] = [];
      
      // Parse with TypeScript compiler
      const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        true
      );
      
      const visit = (node: ts.Node) => {
        // Import declarations: import ... from '...'
        if (ts.isImportDeclaration(node)) {
          const moduleSpecifier = node.moduleSpecifier;
          if (ts.isStringLiteral(moduleSpecifier)) {
            const resolved = this.resolveImport(moduleSpecifier.text, filePath, rootDir);
            if (resolved) imports.push(resolved);
          }
        }
        
        // Export from: export ... from '...'
        if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
          if (ts.isStringLiteral(node.moduleSpecifier)) {
            const resolved = this.resolveImport(node.moduleSpecifier.text, filePath, rootDir);
            if (resolved) imports.push(resolved);
          }
        }
        
        // Dynamic imports: import('...')
        if (ts.isCallExpression(node)) {
          if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
            const arg = node.arguments[0];
            if (arg && ts.isStringLiteral(arg)) {
              const resolved = this.resolveImport(arg.text, filePath, rootDir);
              if (resolved) imports.push(resolved);
            }
          }
        }
        
        // Require: require('...')
        if (ts.isCallExpression(node)) {
          if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
            const arg = node.arguments[0];
            if (arg && ts.isStringLiteral(arg)) {
              const resolved = this.resolveImport(arg.text, filePath, rootDir);
              if (resolved) imports.push(resolved);
            }
          }
        }
        
        ts.forEachChild(node, visit);
      };
      
      visit(sourceFile);
      
      return imports;
    } catch (error) {
      console.warn(`Failed to parse ${filePath}:`, error);
      return [];
    }
  }
  
  /**
   * Resolve import path to absolute file path
   */
  private resolveImport(importPath: string, fromFile: string, rootDir: string): string | null {
    // Skip external modules
    if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
      return null;
    }
    
    const fromDir = path.dirname(fromFile);
    let resolved: string;
    
    if (importPath.startsWith('.')) {
      // Relative import
      resolved = path.resolve(fromDir, importPath);
    } else {
      // Absolute import
      resolved = path.resolve(rootDir, importPath);
    }
    
    // Try with various extensions
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.d.ts'];
    
    // Try exact path
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      return resolved;
    }
    
    // Try with extensions
    for (const ext of extensions) {
      const withExt = resolved + ext;
      if (fs.existsSync(withExt)) {
        return withExt;
      }
    }
    
    // Try as directory with index file
    for (const ext of extensions) {
      const indexFile = path.join(resolved, `index${ext}`);
      if (fs.existsSync(indexFile)) {
        return indexFile;
      }
    }
    
    return null;
  }
  
  /**
   * Find all source files in directory
   */
  private findSourceFiles(dir: string, extensions: string[]): string[] {
    const files: string[] = [];
    
    const walk = (currentPath: string) => {
      if (!fs.existsSync(currentPath)) return;
      
      const stat = fs.statSync(currentPath);
      
      if (stat.isDirectory()) {
        // Skip common directories
        const basename = path.basename(currentPath);
        if (['node_modules', '.git', 'dist', 'build', 'coverage'].includes(basename)) {
          return;
        }
        
        const entries = fs.readdirSync(currentPath);
        for (const entry of entries) {
          walk(path.join(currentPath, entry));
        }
      } else if (stat.isFile()) {
        const ext = path.extname(currentPath);
        if (extensions.includes(ext)) {
          files.push(currentPath);
        }
      }
    };
    
    walk(dir);
    return files;
  }
  
  /**
   * Clear the graph
   */
  clear(): void {
    this.graph.clear();
  }
  
  /**
   * Get graph statistics
   */
  getStats(): {
    totalFiles: number;
    avgImports: number;
    avgImportedBy: number;
    mostImported: { file: string; count: number } | null;
  } {
    const totalFiles = this.graph.size;
    let totalImports = 0;
    let totalImportedBy = 0;
    let mostImported: { file: string; count: number } | null = null;
    
    for (const [file, node] of this.graph.entries()) {
      totalImports += node.imports.length;
      totalImportedBy += node.importedBy.length;
      
      if (!mostImported || node.importedBy.length > mostImported.count) {
        mostImported = { file, count: node.importedBy.length };
      }
    }
    
    return {
      totalFiles,
      avgImports: totalFiles > 0 ? totalImports / totalFiles : 0,
      avgImportedBy: totalFiles > 0 ? totalImportedBy / totalFiles : 0,
      mostImported
    };
  }
}

