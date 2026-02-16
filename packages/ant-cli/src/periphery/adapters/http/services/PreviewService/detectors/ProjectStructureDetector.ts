import * as fs from 'fs';
import * as path from 'path';
import { PackageInfo, ProjectStructure } from '../types';
import { PackageDetector } from './PackageDetector';
import { logger } from '../../../../../../utils/logger';

/**
 * ProjectStructureDetector
 * 
 * Detects project structure based on language/framework profile.
 * 
 * Flow:
 * 1. Determine language from projectProfile (decompose) or filesystem config files
 * 2. Dispatch to language-specific detection strategy
 * 3. Each strategy knows its own config files, structure patterns, and entry points
 * 
 * Node.js/TypeScript is just one of the supported languages, not the default.
 */
export class ProjectStructureDetector {
  private packageDetector: PackageDetector;
  
  constructor(packageDetector?: PackageDetector) {
    this.packageDetector = packageDetector || new PackageDetector();
  }
  
  /**
   * Detect project structure from path.
   * 
   * @param localPath - Absolute path to project root
   * @param projectProfile - Language/framework profile from decompose (via Preview Config)
   */
  async detect(localPath: string, projectProfile?: { language: string; framework?: string }): Promise<ProjectStructure> {
    // 1. Determine language: profile first, filesystem fallback
    const language = this.resolveLanguage(localPath, projectProfile);
    const profile = projectProfile || { language };
    
    logger.debug(`Detecting structure for language=${language}${profile.framework ? ` framework=${profile.framework}` : ''}`, { component: 'ProjectStructureDetector' });
    
    // 2. Dispatch to language-specific detection
    switch (language) {
      case 'typescript':
      case 'javascript':
        return this.detectNodeProject(localPath, profile);
      case 'go':
        return this.detectGoProject(localPath, profile);
      case 'python':
        return this.detectPythonProject(localPath, profile);
      case 'rust':
        return this.detectRustProject(localPath, profile);
      case 'java':
        return this.detectJavaProject(localPath, profile);
      default:
        return this.detectGenericProject(localPath, profile);
    }
  }
  
  /**
   * Lightweight filesystem-based project detection.
   * Returns language, canStart, and structureType WITHOUT reading file contents deeply.
   * Used by PreviewServer.checkCanStart() and GET /status to provide project info
   * even when decompose has not run yet.
   * 
   * @returns detection result, or null if no recognized project files found
   */
  static quickDetect(localPath: string): { language: string; canStart: boolean; structureType: string } | null {
    // Node.js / TypeScript
    const pkgJsonPath = path.join(localPath, 'package.json');
    if (fs.existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
        const hasDevScript = !!(pkg.scripts?.dev || pkg.scripts?.start);
        const hasWorkspaces = !!(pkg.workspaces) || fs.existsSync(path.join(localPath, 'pnpm-workspace.yaml'));
        
        if (hasWorkspaces) {
          // Check monorepo: any workspace package with dev/start script
          const canStart = hasDevScript || ProjectStructureDetector.hasRunnableWorkspacePackage(localPath);
          return { language: 'typescript', canStart, structureType: 'monorepo' };
        }
        return { language: 'typescript', canStart: hasDevScript, structureType: 'frontend-only' };
      } catch {
        return { language: 'typescript', canStart: false, structureType: 'frontend-only' };
      }
    }
    
    // Go
    if (fs.existsSync(path.join(localPath, 'go.mod'))) {
      return { language: 'go', canStart: true, structureType: 'backend-only' };
    }
    
    // Rust
    if (fs.existsSync(path.join(localPath, 'Cargo.toml'))) {
      return { language: 'rust', canStart: true, structureType: 'backend-only' };
    }
    
    // Python
    if (fs.existsSync(path.join(localPath, 'requirements.txt')) ||
        fs.existsSync(path.join(localPath, 'pyproject.toml')) ||
        fs.existsSync(path.join(localPath, 'setup.py'))) {
      return { language: 'python', canStart: true, structureType: 'backend-only' };
    }
    
    // Java
    if (fs.existsSync(path.join(localPath, 'pom.xml')) ||
        fs.existsSync(path.join(localPath, 'build.gradle')) ||
        fs.existsSync(path.join(localPath, 'build.gradle.kts'))) {
      return { language: 'java', canStart: true, structureType: 'backend-only' };
    }
    
    // Makefile (language unknown but may be runnable)
    if (fs.existsSync(path.join(localPath, 'Makefile'))) {
      try {
        const content = fs.readFileSync(path.join(localPath, 'Makefile'), 'utf-8');
        const hasTarget = /^(dev|run|serve):/m.test(content);
        return { language: 'unknown', canStart: hasTarget, structureType: 'backend-only' };
      } catch {
        return { language: 'unknown', canStart: false, structureType: 'backend-only' };
      }
    }
    
    return null;
  }
  
  /**
   * Check if any workspace sub-package has a runnable dev/start script.
   */
  private static hasRunnableWorkspacePackage(localPath: string): boolean {
    for (const dir of ['packages', 'apps']) {
      const dirPath = path.join(localPath, dir);
      if (!fs.existsSync(dirPath)) continue;
      try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          try {
            const subPkg = JSON.parse(fs.readFileSync(path.join(dirPath, entry.name, 'package.json'), 'utf-8'));
            if (subPkg.scripts?.dev || subPkg.scripts?.start) return true;
          } catch { /* skip */ }
        }
      } catch { /* dir not readable */ }
    }
    return false;
  }
  
  /**
   * Resolve language from profile or filesystem config files.
   */
  private resolveLanguage(localPath: string, projectProfile?: { language: string; framework?: string }): string {
    if (projectProfile?.language) {
      return projectProfile.language.toLowerCase();
    }
    
    // Use shared filesystem detection logic
    const detected = ProjectStructureDetector.quickDetect(localPath);
    if (detected) {
      return detected.language;
    }
    
    throw new Error('No recognized project files found (no package.json, go.mod, Cargo.toml, requirements.txt, pom.xml, etc.)');
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Language-specific detection strategies
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  
  /**
   * Node.js / TypeScript detection
   * Supports: single project, fullstack (subdirs), monorepo (workspaces)
   */
  private async detectNodeProject(localPath: string, profile: { language: string; framework?: string }): Promise<ProjectStructure> {
    const rootPkgPath = path.join(localPath, 'package.json');
    if (!fs.existsSync(rootPkgPath)) {
      // Profile says Node but no package.json — treat as single backend
      return this.singlePackage(localPath, 'backend', profile);
    }
    
    const rootPkgJson = JSON.parse(await fs.promises.readFile(rootPkgPath, 'utf-8'));
    
    // Check if monorepo (package.json workspaces OR pnpm-workspace.yaml)
    const workspacePatterns = this.getWorkspacePatterns(localPath, rootPkgJson);
    if (workspacePatterns.length > 0) {
      return await this.detectMonorepoStructure(localPath, rootPkgJson, profile);
    }
    
    // Check subdirectories for fullstack
    const subdirs = await this.findSubdirectories(localPath);
    const packages: PackageInfo[] = [];
    
    for (const subdir of subdirs) {
      const subdirPath = path.join(localPath, subdir);
      const pkgJsonPath = path.join(subdirPath, 'package.json');
      
      if (!fs.existsSync(pkgJsonPath)) continue;
      
      try {
        const pkgJson = JSON.parse(await fs.promises.readFile(pkgJsonPath, 'utf-8'));
        
        // Only include packages with dev script
        if (!pkgJson.scripts?.dev && !pkgJson.scripts?.start) continue;
        
        let pkgType: 'frontend' | 'backend' | 'other' = 'other';
        if (this.packageDetector.isFrontendPackage(pkgJson)) {
          pkgType = 'frontend';
        } else if (this.packageDetector.isBackendPackage(pkgJson)) {
          pkgType = 'backend';
        }
        
        packages.push({
          name: subdir,
          path: subdirPath,
          type: pkgType,
          packageJson: pkgJson,
          projectProfile: profile
        });
      } catch (error) {
        continue;
      }
    }
    
    // Determine type
    const hasFrontend = packages.some(p => p.type === 'frontend');
    const hasBackend = packages.some(p => p.type === 'backend');
    
    if (hasFrontend && hasBackend) {
      const entry = packages.find(p => p.type === 'frontend');
      logger.debug(`Fullstack detected (${packages.length} packages)`, { component: 'ProjectStructureDetector' });
      return { type: 'fullstack', packages, entry };
    }
    
    if (packages.length > 0) {
      const entry = packages[0];
      const type = hasFrontend ? 'frontend-only' : hasBackend ? 'backend-only' : 'frontend-only';
      logger.debug(`${type} detected (${packages.length} package(s))`, { component: 'ProjectStructureDetector' });
      return { type, packages, entry };
    }
    
    // Treat root as single package
    const pkgType = this.packageDetector.isFrontendPackage(rootPkgJson) ? 'frontend' : 
                   this.packageDetector.isBackendPackage(rootPkgJson) ? 'backend' : 'frontend';
    
    return this.singlePackage(localPath, pkgType, profile, rootPkgJson);
  }
  
  /**
   * Go detection
   * Single binary project. Config file: go.mod
   */
  private detectGoProject(localPath: string, profile: { language: string; framework?: string }): ProjectStructure {
    logger.debug(`Go project detected${profile.framework ? ` (${profile.framework})` : ''}`, { component: 'ProjectStructureDetector' });
    return this.singlePackage(localPath, 'backend', profile);
  }
  
  /**
   * Python detection
   * Config files: requirements.txt, pyproject.toml, setup.py
   */
  private detectPythonProject(localPath: string, profile: { language: string; framework?: string }): ProjectStructure {
    // Django/Flask/FastAPI are backend; some Python could be frontend (Streamlit) but rare
    const type = profile.framework?.toLowerCase() === 'streamlit' ? 'frontend' : 'backend';
    logger.debug(`Python project detected${profile.framework ? ` (${profile.framework})` : ''}`, { component: 'ProjectStructureDetector' });
    return this.singlePackage(localPath, type, profile);
  }
  
  /**
   * Rust detection
   * Config file: Cargo.toml
   */
  private detectRustProject(localPath: string, profile: { language: string; framework?: string }): ProjectStructure {
    logger.debug(`Rust project detected`, { component: 'ProjectStructureDetector' });
    return this.singlePackage(localPath, 'backend', profile);
  }
  
  /**
   * Java detection
   * Config files: pom.xml, build.gradle, build.gradle.kts
   */
  private detectJavaProject(localPath: string, profile: { language: string; framework?: string }): ProjectStructure {
    logger.debug(`Java project detected${profile.framework ? ` (${profile.framework})` : ''}`, { component: 'ProjectStructureDetector' });
    return this.singlePackage(localPath, 'backend', profile);
  }
  
  /**
   * Generic / unknown language detection
   * Supports: Makefile-based projects
   */
  private detectGenericProject(localPath: string, profile: { language: string; framework?: string }): ProjectStructure {
    logger.debug(`Generic project detected (language=${profile.language})`, { component: 'ProjectStructureDetector' });
    return this.singlePackage(localPath, 'backend', profile);
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Helpers
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  
  /**
   * Create a single-package project structure.
   */
  private singlePackage(
    localPath: string,
    type: 'frontend' | 'backend' | 'other',
    profile: { language: string; framework?: string },
    packageJson?: any
  ): ProjectStructure {
    const pkg: PackageInfo = {
      name: 'root',
      path: localPath,
      type,
      projectProfile: profile,
      ...(packageJson ? { packageJson } : {}),
    };
    
    const structureType = type === 'frontend' ? 'frontend-only' as const : 'backend-only' as const;
    logger.debug(`Single ${profile.language} package (${structureType})`, { component: 'ProjectStructureDetector' });
    
    return { type: structureType, packages: [pkg], entry: pkg };
  }
  
  /**
   * Detect monorepo structure (Node.js workspaces)
   */
  private async detectMonorepoStructure(localPath: string, rootPkgJson: any, profile: { language: string; framework?: string }): Promise<ProjectStructure> {
    const packages: PackageInfo[] = [];
    const workspacePatterns = this.getWorkspacePatterns(localPath, rootPkgJson);
    
    for (const pattern of workspacePatterns) {
      const resolvedPaths = await this.resolveWorkspacePattern(localPath, pattern);
      
      for (const wsPath of resolvedPaths) {
        const pkgJsonPath = path.join(wsPath, 'package.json');
        if (!fs.existsSync(pkgJsonPath)) continue;
        
        try {
          const pkgJson = JSON.parse(await fs.promises.readFile(pkgJsonPath, 'utf-8'));
          const pkgName = path.relative(localPath, wsPath);
          
          let pkgType: 'frontend' | 'backend' | 'other' = 'other';
          if (this.packageDetector.isFrontendPackage(pkgJson)) {
            pkgType = 'frontend';
          } else if (this.packageDetector.isBackendPackage(pkgJson)) {
            pkgType = 'backend';
          }
          
          // Only include packages with dev script
          if (pkgJson.scripts?.dev || pkgJson.scripts?.start) {
            packages.push({
              name: pkgName,
              path: wsPath,
              type: pkgType,
              packageJson: pkgJson,
              projectProfile: profile
            });
          }
        } catch (error) {
          continue;
        }
      }
    }
    
    // Entry is the first frontend package
    const entry = packages.find(p => p.type === 'frontend');
    
    logger.debug(`Monorepo detected (${packages.length} packages)`, { component: 'ProjectStructureDetector' });
    
    return { type: 'monorepo', packages, entry };
  }
  
  /**
   * Get workspace patterns from package.json workspaces or pnpm-workspace.yaml
   */
  getWorkspacePatterns(localPath: string, rootPkgJson: any): string[] {
    // 1) package.json workspaces (yarn/npm/pnpm)
    if (rootPkgJson?.workspaces) {
      return Array.isArray(rootPkgJson.workspaces)
        ? rootPkgJson.workspaces
        : (rootPkgJson.workspaces.packages || []);
    }
    
    // 2) pnpm-workspace.yaml
    const pnpmWsPath = path.join(localPath, 'pnpm-workspace.yaml');
    if (fs.existsSync(pnpmWsPath)) {
      try {
        const raw = fs.readFileSync(pnpmWsPath, 'utf8');
        return this.parsePnpmWorkspaceYaml(raw);
      } catch {
        return [];
      }
    }
    
    return [];
  }
  
  /**
   * Minimal parser for pnpm-workspace.yaml
   */
  private parsePnpmWorkspaceYaml(yamlText: string): string[] {
    const lines = yamlText.split(/\r?\n/);
    const patterns: string[] = [];
    let inPackages = false;
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      
      if (!inPackages) {
        if (/^packages\s*:/.test(trimmed)) {
          inPackages = true;
        }
        continue;
      }
      
      // Stop when we hit another top-level key
      if (!/^- /.test(trimmed) && /^[a-zA-Z0-9_-]+\s*:/.test(trimmed)) {
        break;
      }
      
      const m = trimmed.match(/^- \s*['"]?([^'"]+)['"]?\s*$/);
      if (m?.[1]) {
        patterns.push(m[1]);
      }
    }
    
    return patterns;
  }
  
  /**
   * Find immediate subdirectories
   */
  private async findSubdirectories(parentPath: string): Promise<string[]> {
    try {
      const entries = await fs.promises.readdir(parentPath, { withFileTypes: true });
      return entries
        .filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
        .map(entry => entry.name);
    } catch (error) {
      return [];
    }
  }
  
  /**
   * Resolve workspace pattern (e.g., "packages/*")
   */
  private async resolveWorkspacePattern(basePath: string, pattern: string): Promise<string[]> {
    if (!pattern.includes('*')) {
      const fullPath = path.join(basePath, pattern);
      return fs.existsSync(fullPath) ? [fullPath] : [];
    }
    
    const baseDir = pattern.replace('/*', '');
    const baseDirPath = path.join(basePath, baseDir);
    
    if (!fs.existsSync(baseDirPath)) return [];
    
    const subdirs = await this.findSubdirectories(baseDirPath);
    return subdirs.map(subdir => path.join(baseDirPath, subdir));
  }
}
