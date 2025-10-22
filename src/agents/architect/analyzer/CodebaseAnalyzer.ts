import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import { ProjectContext, CodebaseNode, FileStructure } from "../types";

export class CodebaseAnalyzer {
  private programs: ts.Program[] = [];
  private nonTsFiles: string[] = [];

  constructor(rootPath: string) {
    // 1. 모든 tsconfig.json 파일 찾기
    const tsconfigPaths = this.findTsConfigs(rootPath);
    console.log(`\n📁 Found ${tsconfigPaths.length} tsconfig.json files:`, tsconfigPaths);

    // 2. 각 tsconfig.json에 대해 TypeScript 프로그램 생성
    for (const configPath of tsconfigPaths) {
      try {
        const { config } = ts.readConfigFile(configPath, ts.sys.readFile);
        const basePath = path.dirname(configPath);
        const { options, fileNames, errors } = ts.parseJsonConfigFileContent(
          config,
          ts.sys,
          basePath
        );

        if (errors.length > 0) {
          console.warn(`⚠️  TypeScript config parse errors in ${configPath}:`, errors);
          continue;
        }

        // 상대 경로를 절대 경로로 변환
        const absoluteFileNames = fileNames.map(f => 
          path.isAbsolute(f) ? f : path.join(basePath, f)
        );

        console.log(`\n📦 Creating TypeScript program for ${configPath}`);
        console.log(`   Files to be included:`, absoluteFileNames);
        
        const program = ts.createProgram(absoluteFileNames, options);
        this.programs.push(program);
      } catch (error) {
        console.error(`❌ Error creating TypeScript program for ${configPath}:`, error);
      }
    }

    // 3. TypeScript 프로그램이 하나도 없으면 기본 설정으로
    if (this.programs.length === 0) {
      console.log("\n⚠️  No valid TypeScript configurations found, using default configuration");
      
      const defaultOptions: ts.CompilerOptions = {
        target: ts.ScriptTarget.Latest,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        esModuleInterop: true,
        skipLibCheck: true,
        jsx: ts.JsxEmit.React
      };

      const sourceFiles = this.findSourceFiles(rootPath)
        .filter(f => /\.(ts|tsx|js|jsx)$/.test(f));
      
      this.programs.push(ts.createProgram(sourceFiles, defaultOptions));
    }

    // 4. 비 TypeScript 파일 찾기
    this.nonTsFiles = this.findSourceFiles(rootPath)
      .filter(f => !/\.(ts|tsx|js|jsx)$/.test(f));
  }

  private findTsConfigs(rootPath: string): string[] {
    const configs: string[] = [];
    
    function walk(dir: string) {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          
          if (entry.isDirectory()) {
            if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
              walk(fullPath);
            }
          } else if (entry.name === 'tsconfig.json') {
            configs.push(fullPath);
          }
        }
      } catch (error) {
        console.error(`❌ Error reading directory ${dir}:`, error);
      }
    }
    
    walk(rootPath);
    return configs;
  }

  async analyze(context: ProjectContext): Promise<CodebaseNode[]> {
    // 1. TypeScript/JavaScript 파일 분석
    const tsFiles = this.programs.flatMap(program => 
      program.getSourceFiles()
        .filter(file => !file.fileName.includes("node_modules"))
        .map(file => ({
          path: file.fileName,
          imports: this.getImports(file),
          exports: this.getExports(file),
          structure: file
        }))
    );
    
    // 2. 다른 파일들 분석
    const otherFiles = this.nonTsFiles.map(file => {
      try {
        const content = fs.readFileSync(file, 'utf8');
        return {
          path: file,
          imports: [],  // 비 TypeScript 파일은 imports/exports 분석 안 함
          exports: [],
          structure: {  // 간단한 파일 정보만 저장
            kind: 'file',
            fileName: file,
            content: content
          } as FileStructure
        };
      } catch (error) {
        console.warn(`⚠️  Could not read file: ${file}`);
        return null;
      }
    }).filter(Boolean) as CodebaseNode[];
    
    const allFiles = [...tsFiles, ...otherFiles];
    console.log(`\n📊 Analysis complete:`,
      `\n   TypeScript files: ${tsFiles.length}`,
      `\n   Other files: ${otherFiles.length}`,
      `\n   Total: ${allFiles.length}`
    );
    
    return allFiles;
  }

  private getImports(file: ts.SourceFile): string[] {
    return file.statements
      .filter(ts.isImportDeclaration)
      .map(imp => {
        if (ts.isStringLiteral(imp.moduleSpecifier)) {
          return imp.moduleSpecifier.text;
        }
        return '';
      })
      .filter(Boolean);
  }

  private getExports(file: ts.SourceFile): string[] {
    return file.statements
      .filter((node): node is ts.VariableStatement | ts.FunctionDeclaration | ts.ClassDeclaration | ts.InterfaceDeclaration | ts.TypeAliasDeclaration => {
        // 1. 지원하는 선언 타입인지 확인
        const isSupported = 
          ts.isFunctionDeclaration(node) || 
          ts.isClassDeclaration(node) ||
          ts.isInterfaceDeclaration(node) ||
          ts.isTypeAliasDeclaration(node) ||
          ts.isVariableStatement(node);

        if (!isSupported) return false;
        
        // 2. export 키워드가 있는지 확인
        return node.modifiers?.some(m => 
          m.kind === ts.SyntaxKind.ExportKeyword
        ) ?? false;
      })
      .flatMap(exp => {
        if (ts.isVariableStatement(exp)) {
          // 변수 선언의 경우 각 선언자 처리
          return exp.declarationList.declarations
            .map(d => ts.isIdentifier(d.name) ? d.name.text : 'default')
            .filter(Boolean);
        } else if ('name' in exp && exp.name && ts.isIdentifier(exp.name)) {
          // 일반적인 선언의 경우
          return [exp.name.text];
        }
        return ['default'];
      });
  }

  private findSourceFiles(rootPath: string): string[] {
    console.log(`\n📂 Scanning directory: ${rootPath}`);
    if (!fs.existsSync(rootPath)) {
      console.error(`❌ Directory does not exist: ${rootPath}`);
      return [];
    }

    const files: string[] = [];
    const ignoreDirs = new Set(['node_modules', 'dist', 'build', '.git', '.next', 'coverage']);
    
    function walk(dir: string, depth: number = 0) {
      console.log(`${'  '.repeat(depth)}📂 Entering: ${path.basename(dir)}`);
      
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        let dirStats = {
          total: entries.length,
          dirs: 0,
          files: 0,
          included: 0
        };
        
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          
          if (entry.isDirectory()) {
            dirStats.dirs++;
            if (!ignoreDirs.has(entry.name) && !entry.name.startsWith('.')) {
              walk(fullPath, depth + 1);
            } else {
              console.log(`${'  '.repeat(depth + 1)}⏭️  Skipping directory: ${entry.name}`);
            }
          } else if (entry.isFile()) {
            dirStats.files++;
            const ext = path.extname(entry.name).toLowerCase();
            const isText = /\.(ts|tsx|js|jsx|md|json|yaml|yml|txt|html|css|scss|less|vue|php|py|rb|go|rs|java|c|cpp|h|hpp)$/.test(ext);
            if (isText) {
              dirStats.included++;
              files.push(fullPath);
              console.log(`${'  '.repeat(depth + 1)}📄 Including: ${entry.name}`);
            }
          }
        }
        
        console.log(`${'  '.repeat(depth)}📊 Directory stats for ${path.basename(dir)}:`,
          `Total: ${dirStats.total},`,
          `Dirs: ${dirStats.dirs},`,
          `Files: ${dirStats.files},`,
          `Included: ${dirStats.included}`
        );
      } catch (error) {
        console.error(`❌ Error reading directory ${dir}:`, error);
      }
    }
    
    walk(rootPath);
    console.log(`\n📊 Total files found: ${files.length}`);
    return files;
  }
}
