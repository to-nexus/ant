/**
 * Artifact Service
 * 
 * Feature 개발 과정의 입출력 artifact 파일 관리
 * - inputs/directives/: 작업 지시사항
 * - inputs/sources/: PRD, Figma 등 입력 자료
 * - outputs/design/: 설계 문서
 * - outputs/reports/: 실행 리포트
 * 
 * ✅ Hexagonal Architecture:
 * - FileSystemPort를 통한 파일 I/O (테스트 가능)
 * - WorkspacePathResolver로 경로 계산
 */

import * as path from "path";
import { GitPort, FileSystemPort } from "../../core/ports";
import { WorkspacePathResolver } from "./WorkspaceResolver";

export type AgentTask = 'design' | 'code' | 'learn' | 'review' | 'plan' | 'doc';

export interface ProjectContext {
  project: string;
  featureFolder: string;
  userId?: string;
  organizationId?: string;
  featurePath?: string;
  workspaceResolver?: any;
  [key: string]: any;
}

export class ArtifactService {
  private static readonly TEMPLATE_MARKER = '<!-- ant:template -->';

  /**
   * Treat "template/placeholder" docs as empty to avoid misleading prompts.
   * - If TEMPLATE_MARKER is present, it's considered not user-filled yet.
   * - If content is only HTML comments, it's considered empty as well.
   */
  private static normalizeUserDoc(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (trimmed.includes(ArtifactService.TEMPLATE_MARKER)) return null;

    // If user left only HTML comments (e.g. "<!-- Add your directive here -->"), treat as empty.
    const withoutComments = trimmed.replace(/<!--[\s\S]*?-->/g, '').trim();
    if (!withoutComments) return null;
    return trimmed;
  }
  /**
   * FileSystemPort는 워크스페이스 루트 기준 "상대경로"만 허용한다.
   * 그런데 WorkspaceResolver/WorkspacePathResolver는 절대경로를 반환하므로,
   * 여기서 일관되게 상대경로로 변환해서 FileSystemPort에 전달한다.
   */
  private static toWorkspaceRelative(fileSystem: FileSystemPort, p: string): string {
    if (!p) return p;
    if (!path.isAbsolute(p)) return p;

    const root = (fileSystem as any).getWorkspaceRoot?.();
    if (root && typeof root === 'string') {
      return path.relative(root, p);
    }

    // Worst-case fallback: strip leading slash.
    return p.startsWith('/') ? p.slice(1) : p;
  }

  /**
   * Extract feature folder name from artifact file path
   * 
   * Examples:
   * - /workspaces/org/user/project/features/skeleton/inputs/prd.md → "skeleton"
   * - /workspaces/local/user/test-app/features/my-feature/inputs/prd.md → "my-feature"
   * 
   * @param inputFile Full path to artifact input file
   * @param projectId Project name to help locate the feature
   * @returns Feature folder name
   */
  static extractFeatureFolderFromPath(inputFile: string | undefined, projectId: string): string {
    if (!inputFile) return "";
    
    const parts = inputFile.split(path.sep);
    const projectIdx = parts.findIndex(p => p === projectId);
    
    if (projectIdx >= 0) {
      const featuresIdx = parts.indexOf('features', projectIdx);
      if (featuresIdx >= 0 && featuresIdx + 1 < parts.length) {
        return parts[featuresIdx + 1];
      }
    }
    
    return "";
  }
  
  /**
   * Get directive for a specific task
   * Priority: directive.md > directive-nnn.md (latest)
   */
  static async getDirective(
    context: ProjectContext,
    task: AgentTask,
    gitPort: GitPort,
    fileSystem: FileSystemPort
  ): Promise<string | null> {
    const featurePathAbs = WorkspacePathResolver.resolveFeaturePath(context);
    const directiveDirAbs = path.join(featurePathAbs, "inputs/directives", task);
    const directiveDir = ArtifactService.toWorkspaceRelative(fileSystem, directiveDirAbs);

    const exists = await fileSystem.fileExists(directiveDir);
    if (!exists) {
      return null;
    }

    // 1. Check directive.md (default)
    const defaultPath = path.join(directiveDir, "directive.md");
    const defaultExists = await fileSystem.fileExists(defaultPath);
    if (defaultExists) {
      const content = await fileSystem.readFile(defaultPath);
      const normalized = ArtifactService.normalizeUserDoc(content);
      if (normalized) return normalized;
    }

    // 2. Find latest directive-nnn.md
    const entries = await fileSystem.readDirectory(directiveDir);
    const files = entries
      .filter(e => !e.isDirectory && /^directive-\d+\.md$/.test(e.name))
      .map(e => {
        const match = e.name.match(/^directive-(\d+)\.md$/);
        return match ? { name: e.name, number: parseInt(match[1]) } : null;
      })
      .filter((item): item is { name: string; number: number } => item !== null)
      .sort((a, b) => b.number - a.number);

    if (files.length > 0) {
      const content = await fileSystem.readFile(path.join(directiveDir, files[0].name));
      const normalized = ArtifactService.normalizeUserDoc(content);
      if (normalized) return normalized;
    }

    return null;
  }

  /**
   * Get source materials (PRD + all resources)
   */
  static async getSource(
    context: ProjectContext,
    gitPort: GitPort,
    fileSystem: FileSystemPort
  ): Promise<{
    prd?: string;
    figmaLink?: string;
    figmaData?: any;
    wireframes?: string[];
  }> {
    const result: any = {};
    
    const featurePathAbs = WorkspacePathResolver.resolveFeaturePath(context);
    const sourceDirAbs = path.join(featurePathAbs, "inputs/sources");
    const sourceDir = ArtifactService.toWorkspaceRelative(fileSystem, sourceDirAbs);
    
    const sourceDirExists = await fileSystem.fileExists(sourceDir);
    if (!sourceDirExists) {
      return result;
    }

    const entries = await fileSystem.readDirectory(sourceDir);

    // 1. PRD (single canonical file: prd.md)
    const canonicalPrd = path.join(sourceDir, "prd.md");
    if (await fileSystem.fileExists(canonicalPrd)) {
      const content = await fileSystem.readFile(canonicalPrd);
      const normalized = ArtifactService.normalizeUserDoc(content);
      if (normalized) {
        result.prd = normalized;
      }
    }

    // 2. Wireframes (images) - legacy: direct images in inputs/sources/
    const imageExtensions = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"];
    const wireframes = entries
      .filter(e => !e.isDirectory && imageExtensions.some(ext => e.name.toLowerCase().endsWith(ext)))
      .map(e => path.join(sourceDir, e.name));
    
    if (wireframes.length > 0) {
      result.wireframes = wireframes;
    }

    return result;
  }

  /**
   * Load UI-specific documents/assets (Figma-derived) for optional injection into code prompts.
   *
   * Design goal:
   * - Keep PRD clean (single canonical: prd.md)
   * - Provide UI spec only when a task is UI-related (promptBuilder decides)
   * - Represent images as an index/manifest (LLM prompt is text-only)
   */
  static async loadUiContext(
    context: ProjectContext,
    gitPort: GitPort,
    fileSystem: FileSystemPort
  ): Promise<{
    uiDoc?: string;
    uiAssets?: {
      screens?: string[];
      components?: string[];
      icons?: string[];
    };
  }> {
    const featurePathAbs = WorkspacePathResolver.resolveFeaturePath(context);
    const sourceDirAbs = path.join(featurePathAbs, "inputs/sources");
    const sourceDir = ArtifactService.toWorkspaceRelative(fileSystem, sourceDirAbs);

    const sourceDirExists = await fileSystem.fileExists(sourceDir);
    if (!sourceDirExists) return {};

    // Known UI doc files (optional)
    // ✅ Canonical: ui-spec.md (ONLY)
    const uiDocFiles = [
      'ui-spec.md',
      'components.md',
      'tokens.md',
      'ui-assets.md',
    ];

    const uiDocParts: string[] = [];

    for (const name of uiDocFiles) {
      const p = path.join(sourceDir, name);
      if (await fileSystem.fileExists(p)) {
        const content = await fileSystem.readFile(p);
        const normalized = ArtifactService.normalizeUserDoc(content);
        if (normalized) {
          uiDocParts.push(`<!-- UI Source: ${name} -->\n\n${normalized}`);
        }
      }
    }

    // UI reference images index (optional)
    // ✅ Separate runtime assets vs references
    // - inputs/assets/**: runtime assets (synced into codebase root, NOT sent to LLM)
    // - inputs/references/**: reference screenshots/states/icons (may be sent to LLM)
    const inputsDirAbs = path.join(featurePathAbs, "inputs");
    const inputsDir = ArtifactService.toWorkspaceRelative(fileSystem, inputsDirAbs);

    const referencesDir = path.join(inputsDir, 'references');
    const screensDir = path.join(referencesDir, 'screens');
    const componentsDir = path.join(referencesDir, 'components');

    const listFiles = async (dir: string, allowExts?: string[]): Promise<string[] | undefined> => {
      if (!(await fileSystem.fileExists(dir))) return undefined;
      const entries = await fileSystem.readDirectory(dir);
      const files = entries
        .filter(e => !e.isDirectory)
        .map(e => e.name)
        .filter(name => !name.startsWith('.')) // exclude .gitkeep and other dotfiles
        .filter(name => name.toLowerCase() !== 'readme.md')
        .filter(name => {
          if (!allowExts || allowExts.length === 0) return true;
          const ext = path.extname(name).toLowerCase();
          return allowExts.includes(ext);
        })
        .map(name => path.join(dir, name))
        .sort();
      return files.length > 0 ? files : undefined;
    };

    const screens = await listFiles(screensDir, ['.png', '.jpg', '.jpeg', '.webp', '.gif']);
    const components = await listFiles(componentsDir, ['.png', '.jpg', '.jpeg', '.webp', '.gif']);

    const uiAssets =
      (screens || components)
        ? { screens, components }
        : undefined;

    // If we have references but no explicit ui-assets.md, add a lightweight manifest section.
    const hasExplicitUiAssetsDoc = await fileSystem.fileExists(path.join(sourceDir, 'ui-assets.md'));
    if (uiAssets && !hasExplicitUiAssetsDoc) {
      const lines: string[] = [];
      lines.push(`# UI References (Index)`);
      lines.push(`> Note: These are reference file paths under inputs/references (not runtime assets).`);
      lines.push(`> IMPORTANT: Runtime assets must be placed under inputs/assets and will be synced into the codebase root.`);
      if (screens?.length) {
        lines.push(`\n## screens`);
        screens.forEach(p => lines.push(`- ${p}`));
      }
      if (components?.length) {
        lines.push(`\n## components`);
        components.forEach(p => lines.push(`- ${p}`));
      }
      uiDocParts.push(lines.join('\n'));
    }

    return {
      uiDoc: uiDocParts.length > 0 ? uiDocParts.join("\n\n---\n\n") : undefined,
      uiAssets,
    };
  }

  /**
   * Find latest design document
   * Supports multiple file naming conventions:
   * - fe-system-design.md (frontend-specific)
   * - be-system-design.md (backend-specific)
   * - system-design.md (legacy or unified)
   * 
   * Returns both content and file path for environment inference
   */
  static async findLatestDesign(
    context: ProjectContext,
    gitPort: GitPort,
    fileSystem: FileSystemPort,
    preferredEnvironment?: 'frontend' | 'backend' | 'any'
  ): Promise<{ content: string; filePath: string } | null> {
    const featurePathAbs = WorkspacePathResolver.resolveFeaturePath(context);
    const designPathAbs = path.join(featurePathAbs, "outputs/design");
    const designPath = ArtifactService.toWorkspaceRelative(fileSystem, designPathAbs);

    // ✅ Try design documents in priority order
    const candidateFiles: string[] = [];
    
    if (preferredEnvironment === 'frontend') {
      // Frontend job: prefer fe-system-design.md
      candidateFiles.push('fe-system-design.md', 'frontend-design.md', 'system-design.md');
    } else if (preferredEnvironment === 'backend') {
      // Backend job: prefer be-system-design.md
      candidateFiles.push('be-system-design.md', 'backend-design.md', 'api-design.md', 'system-design.md');
    } else {
      // No preference or dual environment: try all
      candidateFiles.push(
        'fe-system-design.md',    // Frontend
        'be-system-design.md',    // Backend
        'frontend-design.md',
        'backend-design.md',
        'api-design.md',
        'system-design.md'        // Legacy/unified
      );
    }

    // Try each candidate file
    for (const fileName of candidateFiles) {
      const designFilePath = path.join(designPath, fileName);
      const exists = await fileSystem.fileExists(designFilePath);

      if (exists) {
        const content = await fileSystem.readFile(designFilePath);
        if (content) {
          console.log(`📄 [ArtifactService] Found design document: ${fileName}`);
          return {
            content,
            filePath: fileName  // Return relative filename for environment inference
          };
        }
      }
    }

    return null;
  }

  /**
   * Load design documents for Code Job based on environment
   * 
   * Strategy:
   * - Frontend: api-contract.md + (fe-system-design.md OR system-design.md)
   * - Backend: api-contract.md + (be-system-design.md OR system-design.md)
   * - Unknown: api-contract.md + all available design docs
   * 
   * Returns: { apiContract?, feDesign?, beDesign?, unifiedDesign? }
   */
  static async loadDesignDocuments(
    context: ProjectContext,
    gitPort: GitPort,
    fileSystem: FileSystemPort,
    environment?: 'frontend' | 'backend' | 'unknown'
  ): Promise<{
    apiContract?: string;
    feDesign?: string;
    beDesign?: string;
    unifiedDesign?: string;
  }> {
    const featurePathAbs = WorkspacePathResolver.resolveFeaturePath(context);
    const designPathAbs = path.join(featurePathAbs, "outputs/design");
    const designPath = ArtifactService.toWorkspaceRelative(fileSystem, designPathAbs);
    
    const result: {
      apiContract?: string;
      feDesign?: string;
      beDesign?: string;
      unifiedDesign?: string;
    } = {};

    // ✅ ALWAYS try to load api-contract.md (if exists)
    const apiContractPath = path.join(designPath, 'api-contract.md');
    if (await fileSystem.fileExists(apiContractPath)) {
      const content = await fileSystem.readFile(apiContractPath);
      if (content) {
        result.apiContract = content;
        console.log(`📄 [ArtifactService] Loaded api-contract.md for ${environment || 'unknown'} environment`);
      }
    }

    // ✅ Load environment-specific design documents
    if (environment === 'frontend') {
      // Frontend: Load fe-system-design.md or fallback to system-design.md
      const feDesignPath = path.join(designPath, 'fe-system-design.md');
      if (await fileSystem.fileExists(feDesignPath)) {
        const content = await fileSystem.readFile(feDesignPath);
        if (content) {
          result.feDesign = content;
          console.log(`📄 [ArtifactService] Loaded fe-system-design.md`);
        }
      } else {
        // Fallback: system-design.md
        const unifiedPath = path.join(designPath, 'system-design.md');
        if (await fileSystem.fileExists(unifiedPath)) {
          const content = await fileSystem.readFile(unifiedPath);
          if (content) {
            result.unifiedDesign = content;
            console.log(`📄 [ArtifactService] Loaded system-design.md (frontend fallback)`);
          }
        }
      }
    } else if (environment === 'backend') {
      // Backend: Load be-system-design.md or fallback to system-design.md
      const beDesignPath = path.join(designPath, 'be-system-design.md');
      if (await fileSystem.fileExists(beDesignPath)) {
        const content = await fileSystem.readFile(beDesignPath);
        if (content) {
          result.beDesign = content;
          console.log(`📄 [ArtifactService] Loaded be-system-design.md`);
        }
      } else {
        // Fallback: system-design.md
        const unifiedPath = path.join(designPath, 'system-design.md');
        if (await fileSystem.fileExists(unifiedPath)) {
          const content = await fileSystem.readFile(unifiedPath);
          if (content) {
            result.unifiedDesign = content;
            console.log(`📄 [ArtifactService] Loaded system-design.md (backend fallback)`);
          }
        }
      }
    } else {
      // Unknown environment: Load all available (for decompose phase)
      const feDesignPath = path.join(designPath, 'fe-system-design.md');
      const beDesignPath = path.join(designPath, 'be-system-design.md');
      const unifiedPath = path.join(designPath, 'system-design.md');
      
      if (await fileSystem.fileExists(feDesignPath)) {
        const content = await fileSystem.readFile(feDesignPath);
        if (content) {
          result.feDesign = content;
          console.log(`📄 [ArtifactService] Loaded fe-system-design.md (unknown env)`);
        }
      }
      
      if (await fileSystem.fileExists(beDesignPath)) {
        const content = await fileSystem.readFile(beDesignPath);
        if (content) {
          result.beDesign = content;
          console.log(`📄 [ArtifactService] Loaded be-system-design.md (unknown env)`);
        }
      }
      
      if (await fileSystem.fileExists(unifiedPath)) {
        const content = await fileSystem.readFile(unifiedPath);
        if (content) {
          result.unifiedDesign = content;
          console.log(`📄 [ArtifactService] Loaded system-design.md (unknown env)`);
        }
      }
    }

    return result;
  }

  /**
   * Write report file
   */
  static async writeReportFile(
    context: ProjectContext,
    fileName: string,
    content: string,
    gitPort: GitPort,
    fileSystem: FileSystemPort
  ): Promise<string> {
    const featurePathAbs = WorkspacePathResolver.resolveFeaturePath(context);
    const reportDirAbs = path.join(featurePathAbs, "outputs/reports");
    const reportDir = ArtifactService.toWorkspaceRelative(fileSystem, reportDirAbs);
    await fileSystem.createDirectory(reportDir);
    
    const reportFile = path.join(reportDir, fileName);
    await fileSystem.writeFile(reportFile, content);
    
    return reportFile;
  }

  /**
   * Write design document
   */
  static async writeDesignDocument(
    context: ProjectContext,
    content: string,
    gitPort: GitPort,
    fileSystem: FileSystemPort
  ): Promise<string> {
    const featurePathAbs = WorkspacePathResolver.resolveFeaturePath(context);
    const designDirAbs = path.join(featurePathAbs, "outputs/design");
    const designDir = ArtifactService.toWorkspaceRelative(fileSystem, designDirAbs);
    await fileSystem.createDirectory(designDir);
    
    const timestamp = Date.now();
    const fileName = `system-design-${context.project}-${timestamp}.md`;
    const designFile = path.join(designDir, fileName);
    await fileSystem.writeFile(designFile, content);
    
    return designFile;
  }
}

