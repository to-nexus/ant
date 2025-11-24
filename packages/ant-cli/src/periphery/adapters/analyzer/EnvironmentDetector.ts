import { promises as fs } from 'fs';
import { join } from 'path';
import {
  ProjectEnvironment,
  EnvironmentDetection,
  EnvironmentSignals,
  FileStructure,
  BackendFramework,
  FrontendFramework,
  FullstackFramework
} from '../../../core/types/environment';
import { CodebaseProfile } from '../../../core/types';

/**
 * EnvironmentDetector
 * 
 * Detects the primary execution environment of a project:
 * - Browser (React, Vue SPA)
 * - Node.js API (Express, NestJS, Fastify)
 * - Fullstack (Next.js, Remix)
 * - CLI tools
 * - Config files
 * 
 * Used for environment-aware prompt selection.
 */
export class EnvironmentDetector {
  /**
   * Detect project environment from working directory and codebase profile
   */
  async detectEnvironment(
    workingDir: string,
    codebaseProfile?: CodebaseProfile
  ): Promise<EnvironmentDetection> {
    try {
      // Gather signals from multiple sources
      const packageJson = await this.readPackageJson(workingDir);
      const fileStructure = await this.analyzeFileStructure(workingDir);
      const signals = this.gatherSignals(packageJson, fileStructure, codebaseProfile);
      
      // Determine environment from signals
      return this.determineEnvironment(signals, codebaseProfile);
    } catch (error) {
      console.warn('[EnvironmentDetector] Failed to detect environment:', error);
      
      // Fallback to safe default (browser)
      return {
        primary: ProjectEnvironment.BROWSER,
        confidence: 'low',
        indicators: ['fallback-default'],
        framework: {}
      };
    }
  }
  
  /**
   * Read and parse package.json
   */
  private async readPackageJson(workingDir: string): Promise<any> {
    try {
      const pkgPath = join(workingDir, 'package.json');
      const content = await fs.readFile(pkgPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      return null;
    }
  }
  
  /**
   * Analyze file structure
   */
  private async analyzeFileStructure(workingDir: string): Promise<FileStructure> {
    try {
      const paths: string[] = [];
      const directories = new Set<string>();
      const extensions = new Map<string, number>();
      
      const walkDir = async (dir: string, relativePath: string = '') => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          // Skip node_modules, .git, dist, build
          if (['node_modules', '.git', 'dist', 'build', '.next', 'out'].includes(entry.name)) {
            continue;
          }
          
          const fullPath = join(dir, entry.name);
          const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
          
          if (entry.isDirectory()) {
            directories.add(relPath);
            await walkDir(fullPath, relPath);
          } else {
            paths.push(relPath);
            
            // Count extensions
            const ext = entry.name.split('.').pop() || '';
            extensions.set(ext, (extensions.get(ext) || 0) + 1);
          }
        }
      };
      
      await walkDir(workingDir);
      
      // Check for key files
      const keyFiles = {
        hasPackageJson: paths.includes('package.json'),
        hasIndexHtml: paths.includes('index.html') || paths.includes('public/index.html'),
        hasTsConfig: paths.includes('tsconfig.json'),
        hasViteConfig: paths.some(p => p.startsWith('vite.config')),
        hasNextConfig: paths.some(p => p.startsWith('next.config'))
      };
      
      return {
        paths,
        directories,
        extensions,
        keyFiles
      };
    } catch (error) {
      return {
        paths: [],
        directories: new Set(),
        extensions: new Map(),
        keyFiles: {
          hasPackageJson: false,
          hasIndexHtml: false,
          hasTsConfig: false,
          hasViteConfig: false,
          hasNextConfig: false
        }
      };
    }
  }
  
  /**
   * Gather environment signals from all sources
   */
  private gatherSignals(
    packageJson: any,
    fileStructure: FileStructure,
    codebaseProfile?: CodebaseProfile
  ): EnvironmentSignals {
    const deps = packageJson ? { ...packageJson.dependencies, ...packageJson.devDependencies } : {};
    
    // Frontend signals
    const frontendFrameworks: string[] = [];
    const frontendPatterns: string[] = [];
    
    if (deps.react) frontendFrameworks.push('react');
    if (deps.vue) frontendFrameworks.push('vue');
    if (deps.angular) frontendFrameworks.push('angular');
    if (deps.svelte) frontendFrameworks.push('svelte');
    if (deps.vite) frontendPatterns.push('vite');
    if (deps['@vitejs/plugin-react']) frontendPatterns.push('vite-react');
    
    const hasHtmlEntry = fileStructure.keyFiles.hasIndexHtml;
    const hasBrowserAPIs = fileStructure.directories.has('src/components') ||
                           fileStructure.directories.has('src/hooks') ||
                           fileStructure.directories.has('src/stores');
    
    // Backend signals
    const backendFrameworks: string[] = [];
    const backendPatterns: string[] = [];
    
    if (deps.express) backendFrameworks.push('express');
    if (deps.fastify) backendFrameworks.push('fastify');
    if (deps['@nestjs/core']) backendFrameworks.push('nestjs');
    if (deps.koa) backendFrameworks.push('koa');
    if (deps.hapi) backendFrameworks.push('hapi');
    
    const hasServerStructure = fileStructure.directories.has('src/routes') ||
                               fileStructure.directories.has('src/controllers') ||
                               fileStructure.directories.has('src/api') ||
                               fileStructure.directories.has('server');
    
    const hasDatabaseLayer = fileStructure.directories.has('src/models') ||
                            fileStructure.directories.has('src/entities') ||
                            fileStructure.directories.has('src/database') ||
                            !!deps.prisma ||
                            !!deps.typeorm ||
                            !!deps.mongoose;
    
    // Fullstack signals
    const fullstackFrameworks: string[] = [];
    
    if (deps.next) fullstackFrameworks.push('nextjs');
    if (deps['@remix-run/node']) fullstackFrameworks.push('remix');
    if (deps['@sveltejs/kit']) fullstackFrameworks.push('sveltekit');
    if (deps.nuxt) fullstackFrameworks.push('nuxt');
    
    const hasSSR = fileStructure.keyFiles.hasNextConfig ||
                  fileStructure.directories.has('app') || // Next.js App Router
                  fileStructure.directories.has('pages'); // Next.js Pages Router
    
    const hasAPIRoutes = fileStructure.directories.has('app/api') ||
                        fileStructure.directories.has('pages/api') ||
                        fileStructure.directories.has('app/routes'); // Remix
    
    // Config file detection
    const isConfig = fileStructure.keyFiles.hasViteConfig ||
                    fileStructure.paths.some(p => 
                      p.includes('webpack.config') ||
                      p.includes('rollup.config') ||
                      p.includes('babel.config') ||
                      p.includes('jest.config')
                    );
    
    return {
      frontend: {
        frameworks: frontendFrameworks,
        patterns: frontendPatterns,
        hasHtmlEntry,
        hasBrowserAPIs
      },
      backend: {
        frameworks: backendFrameworks,
        patterns: backendPatterns,
        hasServerStructure,
        hasDatabaseLayer
      },
      fullstack: {
        frameworks: fullstackFrameworks,
        hasSSR,
        hasAPIRoutes
      },
      isConfig
    };
  }
  
  /**
   * Determine final environment from signals
   */
  private determineEnvironment(
    signals: EnvironmentSignals,
    codebaseProfile?: CodebaseProfile
  ): EnvironmentDetection {
    const indicators: string[] = [];
    
    // Priority 1: Fullstack frameworks (they can do both frontend and backend)
    if (signals.fullstack.frameworks.length > 0) {
      const framework = signals.fullstack.frameworks[0] as FullstackFramework;
      indicators.push(`fullstack-framework:${framework}`);
      
      if (signals.fullstack.hasSSR) indicators.push('has-ssr');
      if (signals.fullstack.hasAPIRoutes) indicators.push('has-api-routes');
      
      return {
        primary: ProjectEnvironment.FULLSTACK,
        confidence: 'high',
        indicators,
        framework: {
          fullstack: framework
        }
      };
    }
    
    // Priority 2: Backend API (strong indicators)
    const backendScore = this.calculateBackendScore(signals);
    const frontendScore = this.calculateFrontendScore(signals);
    
    if (backendScore > frontendScore && backendScore >= 2) {
      const framework = signals.backend.frameworks[0] as BackendFramework || 'none';
      indicators.push(...signals.backend.frameworks.map(f => `backend-framework:${f}`));
      
      if (signals.backend.hasServerStructure) indicators.push('server-structure');
      if (signals.backend.hasDatabaseLayer) indicators.push('database-layer');
      if (!signals.frontend.hasHtmlEntry) indicators.push('no-html-entry');
      
      return {
        primary: ProjectEnvironment.NODE_API,
        confidence: backendScore >= 3 ? 'high' : 'medium',
        indicators,
        framework: {
          backend: framework
        }
      };
    }
    
    // Priority 3: Browser (SPA)
    if (frontendScore >= 1 || signals.frontend.hasHtmlEntry) {
      const framework = signals.frontend.frameworks[0] as FrontendFramework || 'none';
      indicators.push(...signals.frontend.frameworks.map(f => `frontend-framework:${f}`));
      
      if (signals.frontend.hasHtmlEntry) indicators.push('html-entry');
      if (signals.frontend.hasBrowserAPIs) indicators.push('browser-apis');
      
      return {
        primary: ProjectEnvironment.BROWSER,
        confidence: frontendScore >= 2 ? 'high' : 'medium',
        indicators,
        framework: {
          frontend: framework
        }
      };
    }
    
    // Priority 4: Config files
    if (signals.isConfig) {
      return {
        primary: ProjectEnvironment.CONFIG,
        confidence: 'medium',
        indicators: ['config-file'],
        framework: {}
      };
    }
    
    // Priority 5: CLI tools (fallback for Node.js without clear API structure)
    if (codebaseProfile?.language === 'typescript' || codebaseProfile?.language === 'javascript') {
      return {
        primary: ProjectEnvironment.NODE_CLI,
        confidence: 'low',
        indicators: ['node-project-fallback'],
        framework: {}
      };
    }
    
    // Default: Browser (safest assumption)
    return {
      primary: ProjectEnvironment.BROWSER,
      confidence: 'low',
      indicators: ['default-fallback'],
      framework: {}
    };
  }
  
  /**
   * Calculate backend score (0-5)
   */
  private calculateBackendScore(signals: EnvironmentSignals): number {
    let score = 0;
    
    if (signals.backend.frameworks.length > 0) score += 2;
    if (signals.backend.hasServerStructure) score += 1;
    if (signals.backend.hasDatabaseLayer) score += 1;
    if (!signals.frontend.hasHtmlEntry) score += 1;
    
    return score;
  }
  
  /**
   * Calculate frontend score (0-4)
   */
  private calculateFrontendScore(signals: EnvironmentSignals): number {
    let score = 0;
    
    if (signals.frontend.frameworks.length > 0) score += 2;
    if (signals.frontend.hasHtmlEntry) score += 1;
    if (signals.frontend.hasBrowserAPIs) score += 1;
    
    return score;
  }
}

