import { promises as fs } from "fs";
import { join } from "path";
import { CodebaseAnalyzerPort, CodebaseProfile } from "../../../core/ports";

/**
 * CodebaseAnalyzer - Detects language and framework from source code
 * 
 * Analyzes file extensions, imports, and configuration files to determine:
 * - Primary language (typescript, javascript, golang)
 * - Framework (react, nextjs, react-native, gin)
 * - Additional metadata (version, package manager, conventions)
 */
export class CodebaseAnalyzer implements CodebaseAnalyzerPort {
  async analyze(filesBlock: string, workingDir: string): Promise<CodebaseProfile> {
    // 1. Detect language from file extensions and content
    const language = this.detectLanguage(filesBlock);
    
    // 2. Detect framework from imports and config files
    const framework = await this.detectFramework(filesBlock, workingDir, language);
    
    // 3. Extract additional metadata
    const version = await this.detectVersion(workingDir, framework);
    const packageManager = await this.detectPackageManager(workingDir, language);
    const conventions = this.extractConventions(filesBlock, language);
    
    return {
      language,
      framework,
      version,
      packageManager,
      conventions
    };
  }
  
  /**
   * Detect primary language from file extensions and content
   */
  private detectLanguage(filesBlock: string): string {
    // Count file extensions
    const tsCount = (filesBlock.match(/\.(tsx?)\b/g) || []).length;
    const jsCount = (filesBlock.match(/\.(jsx?)\b/g) || []).length;
    const goCount = (filesBlock.match(/\.go\b/g) || []).length;
    
    // TypeScript check (higher priority if .ts/.tsx exists)
    if (tsCount > 0) {
      return 'typescript';
    }
    
    // Go check
    if (goCount > 0) {
      return 'golang';
    }
    
    // JavaScript (fallback)
    if (jsCount > 0) {
      return 'javascript';
    }
    
    // Default to JavaScript if no clear language detected
    return 'javascript';
  }
  
  /**
   * Detect framework from imports and configuration files
   */
  private async detectFramework(
    filesBlock: string, 
    workingDir: string,
    language: string
  ): Promise<string | undefined> {
    if (language === 'golang') {
      return this.detectGoFramework(filesBlock);
    }
    
    if (language === 'typescript' || language === 'javascript') {
      return await this.detectJSFramework(filesBlock, workingDir);
    }
    
    return undefined;
  }
  
  /**
   * Detect Go framework (gin)
   */
  private detectGoFramework(filesBlock: string): string | undefined {
    // Check for Gin imports
    if (filesBlock.includes('github.com/gin-gonic/gin')) {
      return 'gin';
    }
    
    return undefined;
  }
  
  /**
   * Detect JavaScript/TypeScript framework
   */
  private async detectJSFramework(
    filesBlock: string, 
    workingDir: string
  ): Promise<string | undefined> {
    try {
      // Read package.json
      const pkgPath = join(workingDir, 'package.json');
      const pkgContent = await fs.readFile(pkgPath, 'utf8');
      const pkg = JSON.parse(pkgContent);
      
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      
      // Priority order: nextjs > react-native > react
      
      // Next.js
      if (deps['next']) {
        return 'nextjs';
      }
      
      // React Native
      if (deps['react-native']) {
        return 'react-native';
      }
      
      // React
      if (deps['react']) {
        return 'react';
      }
    } catch (error) {
      // If package.json not found, fallback to import analysis
    }
    
    // Fallback: Analyze imports in filesBlock
    
    // Next.js specific imports
    if (filesBlock.includes("from 'next/") || filesBlock.includes('from "next/')) {
      return 'nextjs';
    }
    
    // React Native specific imports
    if (filesBlock.includes("from 'react-native'") || 
        filesBlock.includes('from "react-native"')) {
      return 'react-native';
    }
    
    // React imports
    if (filesBlock.includes("from 'react'") || filesBlock.includes('from "react"')) {
      return 'react';
    }
    
    return undefined;
  }
  
  /**
   * Detect framework version from package.json
   */
  private async detectVersion(
    workingDir: string, 
    framework?: string
  ): Promise<string | undefined> {
    if (!framework) return undefined;
    
    try {
      const pkgPath = join(workingDir, 'package.json');
      const pkgContent = await fs.readFile(pkgPath, 'utf8');
      const pkg = JSON.parse(pkgContent);
      
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      
      // Map framework name to package name
      const packageMap: Record<string, string> = {
        'react': 'react',
        'nextjs': 'next',
        'react-native': 'react-native',
      };
      
      const packageName = packageMap[framework];
      if (packageName && deps[packageName]) {
        return deps[packageName].replace(/[\^~]/, '');  // Remove ^/~ prefix
      }
    } catch (error) {
      // Ignore error
    }
    
    return undefined;
  }
  
  /**
   * Detect package manager from lock files
   */
  private async detectPackageManager(
    workingDir: string,
    language: string
  ): Promise<string | undefined> {
    if (language === 'golang') {
      return 'go';
    }
    
    try {
      // Check for lock files
      const files = await fs.readdir(workingDir);
      
      if (files.includes('pnpm-lock.yaml')) {
        return 'pnpm';
      }
      
      if (files.includes('yarn.lock')) {
        return 'yarn';
      }
      
      if (files.includes('package-lock.json')) {
        return 'npm';
      }
    } catch (error) {
      // Ignore error
    }
    
    return 'npm';  // Default
  }
  
  /**
   * Extract naming conventions from code
   */
  private extractConventions(
    filesBlock: string, 
    language: string
  ): CodebaseProfile['conventions'] {
    if (language === 'golang') {
      return {
        naming: 'PascalCase',  // Go uses PascalCase for exports
        imports: 'esm',  // Not applicable for Go, but keep interface consistent
      };
    }
    
    // Detect camelCase vs snake_case
    const hasCamelCase = /\b[a-z][a-zA-Z0-9]+\b/.test(filesBlock);
    const hasSnakeCase = /\b[a-z][a-z0-9_]+_[a-z0-9_]+\b/.test(filesBlock);
    
    const naming = hasSnakeCase && !hasCamelCase ? 'snake_case' : 'camelCase';
    
    // Detect import style (ESM vs CommonJS)
    const hasESM = filesBlock.includes('import ') && filesBlock.includes(' from ');
    const hasCommonJS = filesBlock.includes('require(');
    
    const imports = hasESM ? 'esm' : hasCommonJS ? 'commonjs' : 'esm';
    
    return { naming, imports };
  }
}

