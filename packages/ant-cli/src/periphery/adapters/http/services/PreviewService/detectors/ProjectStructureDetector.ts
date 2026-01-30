import * as fs from 'fs';
import * as path from 'path';
import { PackageInfo, ProjectStructure } from '../types';
import { PackageDetector } from './PackageDetector';
import { logger } from '../../../../../../utils/logger';

/**
 * ProjectStructureDetector
 * 
 * Detects project structure: monorepo, fullstack, frontend-only, backend-only.
 * Identifies all runnable packages and determines the entry point.
 */
export class ProjectStructureDetector {
  private packageDetector: PackageDetector;
  
  constructor(packageDetector?: PackageDetector) {
    this.packageDetector = packageDetector || new PackageDetector();
  }
  
  /**
   * Detect project structure from path
   */
  async detect(localPath: string): Promise<ProjectStructure> {
    const rootPkgPath = path.join(localPath, 'package.json');
    if (!fs.existsSync(rootPkgPath)) {
      throw new Error('package.json not found');
    }
    
    const rootPkgJson = JSON.parse(await fs.promises.readFile(rootPkgPath, 'utf-8'));
    
    // Check if monorepo (package.json workspaces OR pnpm-workspace.yaml)
    const workspacePatterns = this.getWorkspacePatterns(localPath, rootPkgJson);
    if (workspacePatterns.length > 0) {
      return await this.detectMonorepoStructure(localPath, rootPkgJson);
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
          packageJson: pkgJson
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
    
    const pkg: PackageInfo = {
      name: 'root',
      path: localPath,
      type: pkgType,
      packageJson: rootPkgJson
    };
    
    logger.debug(`Single package detected (${pkgType})`, { component: 'ProjectStructureDetector' });
    
    return { 
      type: pkgType === 'backend' ? 'backend-only' : 'frontend-only', 
      packages: [pkg], 
      entry: pkg 
    };
  }
  
  /**
   * Detect monorepo structure
   */
  private async detectMonorepoStructure(localPath: string, rootPkgJson: any): Promise<ProjectStructure> {
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
              packageJson: pkgJson
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
