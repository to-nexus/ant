import { WorkspaceResolver } from '../../infrastructure/workspace/WorkspaceResolver';
import { GitPort } from '../ports/git';
import { FileLoader } from './loaders/FileLoader';
import * as path from 'path';

export interface ReferenceContext {
  project: string;
  branch: string;
  files: Array<{ path: string; content: string }>;
  stats: {
    filesLoaded: number;
    estimatedTokens: number;
  };
}

/**
 * Parse reference mentions from natural language directive
 * 
 * Patterns detected:
 * - "ant-pong-be의 API를 참고해서"
 * - "백엔드(ant-pong-be)를 확인하고"
 * - "ant-pong-be/feature/skeleton 브랜치 참조"
 * - "ant-pong-fe 프로젝트에서 확인 필요"
 */
export function parseReferenceFromDirective(directive: string): Array<{ project: string; branch?: string }> {
  const refs: Array<{ project: string; branch?: string }> = [];
  
  // Pattern 1: project/branch format (e.g., "ant-pong-be/feature/skeleton")
  const pathPattern = /([a-zA-Z0-9_-]+)\/([a-zA-Z0-9/_-]+)(?:\s+브랜치|\s+branch)?/g;
  let match;
  
  while ((match = pathPattern.exec(directive)) !== null) {
    const project = match[1];
    const branch = match[2];
    
    // Only include if it looks like a project name (contains dash or underscore)
    if (project.includes('-') || project.includes('_')) {
      refs.push({ project, branch });
    }
  }
  
  // Pattern 2: project name in context (e.g., "ant-pong-be를 참고", "백엔드(ant-pong-be)")
  const contextPatterns = [
    /([a-zA-Z0-9_-]+)\s*(?:를|을|의|에서|프로젝트)?\s*(?:참고|확인|보고|체크)/g,
    /(?:백엔드|프론트엔드|frontend|backend|api|서버)\s*\(?([a-zA-Z0-9_-]+)\)?/g,
    /([a-zA-Z0-9_-]+)\s+(?:API|api|endpoint|응답|response)/g
  ];
  
  for (const pattern of contextPatterns) {
    while ((match = pattern.exec(directive)) !== null) {
      const project = match[1];
      
      // Filter: must contain dash/underscore and be reasonable length
      if ((project.includes('-') || project.includes('_')) && 
          project.length >= 5 && 
          project.length <= 30) {
        // Avoid duplicates
        if (!refs.some(r => r.project === project)) {
          refs.push({ project });
        }
      }
    }
  }
  
  console.log(`   🔍 Detected ${refs.length} reference project(s) from directive`);
  refs.forEach(r => {
    console.log(`      - ${r.project}${r.branch ? ` (${r.branch})` : ''}`);
  });
  
  return refs;
}

/**
 * Load reference repository code
 * Provides read-only context for cross-project understanding
 */
export class ReferenceLoader {
  constructor(
    private workspaceResolver: WorkspaceResolver,
    private gitPort: GitPort
  ) {}

  /**
   * Load reference project code
   */
  async loadReference(
    project: string,
    branch: string | undefined,
    userContext: any,
    options: {
      maxFiles?: number;
      maxTokens?: number;
      filePatterns?: string[];
    } = {}
  ): Promise<ReferenceContext> {
    
    const maxFiles = options.maxFiles || 10;
    const maxTokens = options.maxTokens || 30000;
    
    // 1. Resolve project path
    const projectPath = this.workspaceResolver.getProjectPath(
      userContext,
      project
    );
    
    if (!await this.gitPort.fileExists(projectPath)) {
      throw new Error(
        `Reference project not found: ${project}\n` +
        `Path: ${projectPath}`
      );
    }
    
    // 2. Check branch existence
    let targetBranch = branch || 'main';
    
    try {
      const branches = await this.gitPort.getBranches();
      
      if (branch && !branches.includes(branch)) {
        console.warn(`   ⚠️  Branch '${branch}' not found in ${project}`);
        console.warn(`   ↪️  Falling back to default branch`);
        
        // Try main/master
        if (branches.includes('main')) {
          targetBranch = 'main';
        } else if (branches.includes('master')) {
          targetBranch = 'master';
        } else if (branches.length > 0) {
          targetBranch = branches[0];
        }
      }
    } catch (error) {
      console.warn(`   ⚠️  Could not get branches for ${project}, using current branch`);
      targetBranch = await this.gitPort.getCurrentBranch();
    }
    
    console.log(`   📂 Loading reference: ${project} (${targetBranch})`);
    
    // 3. Note: Git checkout is handled externally - we just read files from current state
    // For now, always use current branch (branch switching will be added later if needed)
    
    try {
      // 4. Load files (with patterns)
      const fileLoader = new FileLoader();
      
      // Smart file selection
      const patterns = options.filePatterns || await this.getDefaultPatterns(projectPath);
      const files = await this.selectFiles(projectPath, patterns, maxFiles);
      
      const result = await fileLoader.load(
        files.map(f => ({ 
          path: f, 
          sources: [{ type: 'keyword' as const, matches: 0 }],  // Use keyword as reference marker
          priority: 'normal' as const, 
          hasLocalChanges: false 
        })),
        projectPath,
        this.gitPort,
        maxTokens
      );
      
      console.log(`   ✅ Loaded ${result.stats.filesLoaded} files (~${result.stats.estimatedTokens} tokens)`);
      
      return {
        project,
        branch: targetBranch,
        files: result.files as any,
        stats: result.stats
      };
      
    } catch (error) {
      throw error;
    }
  }
  
  /**
   * Select relevant files based on patterns
   */
  private async selectFiles(
    projectPath: string,
    patterns: string[],
    maxFiles: number
  ): Promise<string[]> {
    // Use simple fs-based file finding instead of glob
    const fs = await import('fs');
    const pathLib = await import('path');
    const allFiles: string[] = [];
    
    // Simple recursive file finder
    const findFiles = async (dir: string, baseDir: string): Promise<void> => {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = pathLib.join(dir, entry.name);
        const relativePath = pathLib.relative(baseDir, fullPath);
        
        // Skip excluded directories
        if (entry.isDirectory()) {
          if (['node_modules', 'dist', 'build', '.git', 'coverage'].includes(entry.name)) {
            continue;
          }
          await findFiles(fullPath, baseDir);
        } else if (entry.isFile()) {
          // Check if matches any pattern (simple extension check)
          const ext = pathLib.extname(entry.name);
          if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
            allFiles.push(relativePath);
          }
        }
      }
    };
    
    await findFiles(projectPath, projectPath);
    
    // Apply pattern filtering (simple string matching)
    const filtered = allFiles.filter(file => {
      return patterns.some(pattern => {
        // Simple pattern matching: src/controllers/** matches src/controllers/foo.ts
        const patternParts = pattern.split('**');
        if (patternParts.length === 2) {
          return file.startsWith(patternParts[0]);
        }
        return file.includes(pattern.replace('/**', '').replace('/*', ''));
      });
    });
    
    return filtered.slice(0, maxFiles);
  }
  
  /**
   * Get default file patterns based on project type
   */
  private async getDefaultPatterns(projectPath: string): Promise<string[]> {
    const fs = await import('fs');
    const pkgPath = path.join(projectPath, 'package.json');
    
    if (!fs.existsSync(pkgPath)) {
      return ['src/**/*.{ts,tsx,js,jsx}'];
    }
    
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    
    // Backend patterns
    if (deps['@nestjs/core'] || deps['express'] || deps['koa'] || deps['fastify']) {
      return [
        'src/**/controller*.{ts,js}',
        'src/**/route*.{ts,js}',
        'src/**/service*.{ts,js}',
        'src/**/dto/*.{ts,js}',
        'src/**/types/**/*.{ts,js}',
        'src/**/*.gateway.{ts,js}'
      ];
    }
    
    // Frontend patterns
    if (deps['react'] || deps['vue'] || deps['@angular/core']) {
      return [
        'src/services/**/*.{ts,tsx,js,jsx}',
        'src/api/**/*.{ts,tsx,js,jsx}',
        'src/types/**/*.ts',
        'src/hooks/**/*.{ts,tsx}'
      ];
    }
    
    return ['src/**/*.{ts,tsx,js,jsx}'];
  }
}

