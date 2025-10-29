import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

/**
 * Symbol location
 */
export interface SymbolLocation {
  file: string;
  line: number;
  column: number;
  text: string;
}

/**
 * ASTAnalyzer
 * 
 * Precise code analysis using TypeScript compiler API
 * Finds function calls, variable references, type usages
 */
export class ASTAnalyzer {
  /**
   * Find all files that use a specific function
   */
  async findFunctionUsages(
    functionName: string,
    rootDir: string,
    extensions: string[] = ['.ts', '.tsx', '.js', '.jsx']
  ): Promise<SymbolLocation[]> {
    const files = this.findSourceFiles(rootDir, extensions);
    const locations: SymbolLocation[] = [];
    
    for (const file of files) {
      const fileLocations = await this.findFunctionUsagesInFile(functionName, file);
      locations.push(...fileLocations);
    }
    
    return locations;
  }
  
  /**
   * Find all files that reference a specific variable/constant
   */
  async findVariableUsages(
    variableName: string,
    rootDir: string
  ): Promise<SymbolLocation[]> {
    const files = this.findSourceFiles(rootDir, ['.ts', '.tsx', '.js', '.jsx']);
    const locations: SymbolLocation[] = [];
    
    for (const file of files) {
      const fileLocations = await this.findVariableUsagesInFile(variableName, file);
      locations.push(...fileLocations);
    }
    
    return locations;
  }
  
  /**
   * Find all files that use a specific type/interface
   */
  async findTypeUsages(
    typeName: string,
    rootDir: string
  ): Promise<SymbolLocation[]> {
    const files = this.findSourceFiles(rootDir, ['.ts', '.tsx']);
    const locations: SymbolLocation[] = [];
    
    for (const file of files) {
      const fileLocations = await this.findTypeUsagesInFile(typeName, file);
      locations.push(...fileLocations);
    }
    
    return locations;
  }
  
  /**
   * Get all affected files for a directive using AST analysis
   */
  async getAffectedFiles(
    directive: string,
    rootDir: string
  ): Promise<string[]> {
    // Extract potential symbols from directive
    const symbols = this.extractSymbols(directive);
    
    const affectedFiles = new Set<string>();
    
    for (const symbol of symbols) {
      // Try as function
      const functionUsages = await this.findFunctionUsages(symbol, rootDir);
      for (const location of functionUsages) {
        affectedFiles.add(location.file);
      }
      
      // Try as variable
      const variableUsages = await this.findVariableUsages(symbol, rootDir);
      for (const location of variableUsages) {
        affectedFiles.add(location.file);
      }
      
      // Try as type
      const typeUsages = await this.findTypeUsages(symbol, rootDir);
      for (const location of typeUsages) {
        affectedFiles.add(location.file);
      }
    }
    
    return Array.from(affectedFiles);
  }
  
  /**
   * Find function usages in a single file
   */
  private async findFunctionUsagesInFile(
    functionName: string,
    filePath: string
  ): Promise<SymbolLocation[]> {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const locations: SymbolLocation[] = [];
      
      const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        true
      );
      
      const visit = (node: ts.Node) => {
        // Function calls
        if (ts.isCallExpression(node)) {
          const expression = node.expression;
          let name: string | null = null;
          
          if (ts.isIdentifier(expression)) {
            name = expression.text;
          } else if (ts.isPropertyAccessExpression(expression)) {
            name = expression.name.text;
          }
          
          if (name === functionName) {
            const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
            locations.push({
              file: filePath,
              line: line + 1,
              column: character + 1,
              text: node.getText(sourceFile).slice(0, 50)
            });
          }
        }
        
        ts.forEachChild(node, visit);
      };
      
      visit(sourceFile);
      return locations;
    } catch (error) {
      return [];
    }
  }
  
  /**
   * Find variable usages in a single file
   */
  private async findVariableUsagesInFile(
    variableName: string,
    filePath: string
  ): Promise<SymbolLocation[]> {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const locations: SymbolLocation[] = [];
      
      const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        true
      );
      
      const visit = (node: ts.Node) => {
        if (ts.isIdentifier(node) && node.text === variableName) {
          const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
          locations.push({
            file: filePath,
            line: line + 1,
            column: character + 1,
            text: node.getText(sourceFile)
          });
        }
        
        ts.forEachChild(node, visit);
      };
      
      visit(sourceFile);
      return locations;
    } catch (error) {
      return [];
    }
  }
  
  /**
   * Find type usages in a single file
   */
  private async findTypeUsagesInFile(
    typeName: string,
    filePath: string
  ): Promise<SymbolLocation[]> {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const locations: SymbolLocation[] = [];
      
      const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        true
      );
      
      const visit = (node: ts.Node) => {
        // Type references
        if (ts.isTypeReferenceNode(node)) {
          const typeName_ = node.typeName;
          if (ts.isIdentifier(typeName_) && typeName_.text === typeName) {
            const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
            locations.push({
              file: filePath,
              line: line + 1,
              column: character + 1,
              text: node.getText(sourceFile)
            });
          }
        }
        
        ts.forEachChild(node, visit);
      };
      
      visit(sourceFile);
      return locations;
    } catch (error) {
      return [];
    }
  }
  
  /**
   * Extract potential symbols from directive
   */
  private extractSymbols(directive: string): string[] {
    const symbols = new Set<string>();
    
    // Find camelCase or PascalCase identifiers
    const identifierRegex = /\b[a-z][a-zA-Z0-9]*\b|\b[A-Z][a-zA-Z0-9]*\b/g;
    const matches = directive.match(identifierRegex);
    
    if (matches) {
      for (const match of matches) {
        // Filter out common words
        if (match.length > 3 && !this.isCommonWord(match)) {
          symbols.add(match);
        }
      }
    }
    
    // Find quoted strings (function/variable names)
    const quotedRegex = /['"`]([a-zA-Z_][a-zA-Z0-9_]*)['"`]/g;
    let quotedMatch;
    while ((quotedMatch = quotedRegex.exec(directive)) !== null) {
      symbols.add(quotedMatch[1]);
    }
    
    return Array.from(symbols);
  }
  
  /**
   * Check if word is common (should be filtered)
   */
  private isCommonWord(word: string): boolean {
    const common = new Set([
      'the', 'this', 'that', 'with', 'from', 'should', 'would', 'could',
      'have', 'been', 'will', 'what', 'when', 'where', 'which', 'their',
      'there', 'these', 'those', 'such', 'into', 'through', 'during',
      'before', 'after', 'above', 'below', 'between', 'under', 'again',
      'function', 'const', 'variable', 'class', 'interface', 'type'
    ]);
    
    return common.has(word.toLowerCase());
  }
  
  /**
   * Find all source files
   */
  private findSourceFiles(dir: string, extensions: string[]): string[] {
    const files: string[] = [];
    
    const walk = (currentPath: string) => {
      if (!fs.existsSync(currentPath)) return;
      
      const stat = fs.statSync(currentPath);
      
      if (stat.isDirectory()) {
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
}

