/**
 * Artifact Service
 * 
 * Feature 개발 과정의 입출력 artifact 파일 관리
 * - inputs/directives/: 작업 지시사항
 * - inputs/sources/: PRD, Figma 등 입력 자료
 * - outputs/design/: 설계 문서
 * - outputs/evals/: 평가 리포트
 * 
 * ✅ Hexagonal Architecture:
 * - FileSystemPort를 통한 파일 I/O (테스트 가능)
 * - WorkspacePathResolver로 경로 계산
 */

import * as path from "path";
import { GitPort, FileSystemPort } from "../../core/ports";
import { WorkspacePathResolver } from "./WorkspaceResolver";
import { ParsedUiDocs } from "../../core/types/uiDoc";
import {
  parseUiDocs,
  getUiSectionsForTask,
  getAllUiContent,
  generateUiSectionsSummary,
} from "./UiDocParser";

export type AgentJob = 'design' | 'code' | 'learn' | 'review' | 'plan' | 'doc';

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
    job: AgentJob,
    gitPort: GitPort,
    fileSystem: FileSystemPort
  ): Promise<string | null> {
    const featurePathAbs = WorkspacePathResolver.resolveFeaturePath(context);
    const directiveDirAbs = path.join(featurePathAbs, "inputs/directives", job);
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
   * Load UI documents as parsed structure for split injection.
   * 
   * This enables token-efficient injection:
   * - Only requested sections are injected into prompts
   * - Decompose prompt receives TOC (section list) only
   * - Plan/CodeGen prompts receive specific sections based on task.uiSections
   * 
   * @returns ParsedUiDocs structure with:
   *   - tokens: Full ui-tokens.json content
   *   - assets: Full ui-assets.json content
   *   - specSections: Map of section ID → content (from ui-spec.json)
   *   - specToc: Table of contents (for decompose prompt)
   */
  static async loadParsedUiContext(
    context: ProjectContext,
    gitPort: GitPort,
    fileSystem: FileSystemPort
  ): Promise<ParsedUiDocs | null> {
    const featurePathAbs = context.featurePath || WorkspacePathResolver.resolveFeaturePath(context);
    const designDirAbs = path.join(featurePathAbs, "outputs/design");
    const designDir = ArtifactService.toWorkspaceRelative(fileSystem, designDirAbs);

    const designDirExists = await fileSystem.fileExists(designDir);
    if (!designDirExists) {
      console.log(`⚠️  [ArtifactService] loadParsedUiContext: designDir not found: ${designDir}`);
      return null;
    }

    // Read individual UI document files
    let uiSpec: string | undefined;
    let uiTokens: string | undefined;
    let uiAssets: string | undefined;

    // ui-spec.json
    const specPath = path.join(designDir, 'ui-spec.json');
    if (await fileSystem.fileExists(specPath)) {
      const content = await fileSystem.readFile(specPath);
      uiSpec = ArtifactService.normalizeUserDoc(content) || undefined;
      if (uiSpec) {
        console.log(`   ✅ [loadParsedUiContext] ui-spec.json: loaded (${uiSpec.length} chars)`);
      }
    }

    // ui-tokens.json
    const tokensPath = path.join(designDir, 'ui-tokens.json');
    if (await fileSystem.fileExists(tokensPath)) {
      const content = await fileSystem.readFile(tokensPath);
      uiTokens = ArtifactService.normalizeUserDoc(content) || undefined;
      if (uiTokens) {
        console.log(`   ✅ [loadParsedUiContext] ui-tokens.json: loaded (${uiTokens.length} chars)`);
      }
    }

    // ui-assets.json
    const assetsPath = path.join(designDir, 'ui-assets.json');
    if (await fileSystem.fileExists(assetsPath)) {
      const content = await fileSystem.readFile(assetsPath);
      uiAssets = ArtifactService.normalizeUserDoc(content) || undefined;
      if (uiAssets) {
        console.log(`   ✅ [loadParsedUiContext] ui-assets.json: loaded (${uiAssets.length} chars)`);
      }
    }

    // If no UI docs found, return null
    if (!uiSpec && !uiTokens && !uiAssets) {
      console.log(`   ⚠️  [loadParsedUiContext] No UI documents found`);
      return null;
    }

    // Parse into structured format
    const parsed = parseUiDocs(uiSpec, uiTokens, uiAssets);
    
    console.log(`   📊 [loadParsedUiContext] Parsed UI docs:`);
    console.log(`      - Tokens: ${parsed.tokensTokenEstimate || 0} estimated tokens`);
    console.log(`      - Assets: ${parsed.assetsTokenEstimate || 0} estimated tokens`);
    console.log(`      - Spec sections: ${parsed.specSections.size} sections, ~${parsed.specTotalTokens} tokens total`);
    
    return parsed;
  }

  /**
   * Get UI document content for a specific task based on uiSections array.
   * 
   * @param parsedDocs - ParsedUiDocs from loadParsedUiContext
   * @param uiSections - Array of section IDs requested by the task
   * @returns Combined content string for the requested sections
   */
  static getUiDocForTask(
    parsedDocs: ParsedUiDocs,
    uiSections?: string[]
  ): string {
    if (!uiSections || uiSections.length === 0) {
      // No specific sections requested - return all content
      console.log(`   📄 [getUiDocForTask] No uiSections specified - returning all UI content`);
      return getAllUiContent(parsedDocs);
    }
    
    console.log(`   📄 [getUiDocForTask] Extracting ${uiSections.length} sections: ${uiSections.join(', ')}`);
    return getUiSectionsForTask(parsedDocs, uiSections);
  }

  /**
   * Generate UI sections summary for decompose prompt.
   * Provides section names and token estimates without full content.
   * 
   * @param parsedDocs - ParsedUiDocs from loadParsedUiContext
   * @returns Summary text suitable for decompose prompt
   */
  static getUiSectionsSummary(parsedDocs: ParsedUiDocs): string {
    return generateUiSectionsSummary(parsedDocs);
  }

  /**
   * Reference images for UI (legacy support).
   * Returns file paths under inputs/references/ if they exist.
   */
  static async loadUiReferenceImages(
    context: ProjectContext,
    fileSystem: FileSystemPort
  ): Promise<{
    screens?: string[];
    components?: string[];
  } | undefined> {
    const featurePathAbs = context.featurePath || WorkspacePathResolver.resolveFeaturePath(context);
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
        .filter(name => !name.startsWith('.'))
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

    if (!screens && !components) {
      return undefined;
    }

    return { screens, components };
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

    // ✅ DEBUG: Log path resolution for troubleshooting
    console.log(`🔍 [ArtifactService.findLatestDesign] Path resolution:`);
    console.log(`   context.project: ${context.project}`);
    console.log(`   context.featureFolder: ${context.featureFolder}`);
    console.log(`   context.featurePath: ${context.featurePath || 'undefined'}`);
    console.log(`   featurePathAbs (resolved): ${featurePathAbs}`);
    console.log(`   designPathAbs: ${designPathAbs}`);
    console.log(`   designPath (workspace-relative): ${designPath}`);
    const fsRoot = (fileSystem as any).getWorkspaceRoot?.() || 'unknown';
    console.log(`   fileSystem.workspaceRoot: ${fsRoot}`);

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
   * Design Documents Result Type
   * Supports both legacy single docs and multi-package (monorepo/MSA) patterns
   */
  static readonly DesignDocsResultType = {} as {
    apiContract?: string;
    // Legacy single docs (backward compatible)
    feDesign?: string;           // fe-system-design.md
    beDesign?: string;           // be-system-design.md
    unifiedDesign?: string;      // system-design.md
    // Multi-package docs (monorepo/MSA)
    feDesigns?: { [pkg: string]: string };  // fe-system-design-{pkg}.md
    beDesigns?: { [svc: string]: string };  // be-system-design-{svc}.md
  };

  /**
   * Load design documents for Code Job
   * 
   * Strategy:
   * 1. ALWAYS load api-contract.md if exists
   * 2. Scan for multi-package patterns (fe-system-design-*.md, be-system-design-*.md)
   * 3. Fall back to legacy single docs (fe-system-design.md, be-system-design.md)
   * 4. Final fallback to unified system-design.md
   * 
   * @returns DesignDocs with both legacy and multi-package support
   */
  static async loadDesignDocuments(
    context: ProjectContext,
    gitPort: GitPort,
    fileSystem: FileSystemPort,
    environment?: 'frontend' | 'backend' | 'unknown'
  ): Promise<typeof ArtifactService.DesignDocsResultType> {
    const featurePathAbs = WorkspacePathResolver.resolveFeaturePath(context);
    const designPathAbs = path.join(featurePathAbs, "outputs/design");
    const designPath = ArtifactService.toWorkspaceRelative(fileSystem, designPathAbs);
    
    console.log(`🔍 [ArtifactService.loadDesignDocuments] designPath: ${designPath}`);
    
    const result: typeof ArtifactService.DesignDocsResultType = {};

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 1. ALWAYS load api-contract.md (if exists)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const apiContractPath = path.join(designPath, 'api-contract.md');
    if (await fileSystem.fileExists(apiContractPath)) {
      const content = await fileSystem.readFile(apiContractPath);
      if (content) {
        result.apiContract = content;
        console.log(`📄 [ArtifactService] Loaded api-contract.md`);
      }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 2. Scan for multi-package design documents
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const designFiles = await ArtifactService.listDesignFiles(fileSystem, designPath);
    
    // Parse multi-package patterns
    const feMultiPattern = /^fe-system-design-(.+)\.md$/;
    const beMultiPattern = /^be-system-design-(.+)\.md$/;
    
    for (const file of designFiles) {
      const feMatch = file.match(feMultiPattern);
      if (feMatch) {
        const pkgName = feMatch[1];
        const filePath = path.join(designPath, file);
        const content = await fileSystem.readFile(filePath);
        if (content) {
          if (!result.feDesigns) result.feDesigns = {};
          result.feDesigns[pkgName] = content;
          console.log(`📄 [ArtifactService] Loaded fe-system-design-${pkgName}.md (multi-frontend)`);
        }
      }
      
      const beMatch = file.match(beMultiPattern);
      if (beMatch) {
        const svcName = beMatch[1];
        const filePath = path.join(designPath, file);
        const content = await fileSystem.readFile(filePath);
        if (content) {
          if (!result.beDesigns) result.beDesigns = {};
          result.beDesigns[svcName] = content;
          console.log(`📄 [ArtifactService] Loaded be-system-design-${svcName}.md (MSA)`);
        }
      }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 3. Load legacy single docs (backward compatible)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const shouldLoadFe = environment === 'frontend' || environment === 'unknown';
    const shouldLoadBe = environment === 'backend' || environment === 'unknown';
    
    // Load fe-system-design.md (legacy single frontend)
    if (shouldLoadFe && !result.feDesigns) {
      const feDesignPath = path.join(designPath, 'fe-system-design.md');
      if (await fileSystem.fileExists(feDesignPath)) {
        const content = await fileSystem.readFile(feDesignPath);
        if (content) {
          result.feDesign = content;
          console.log(`📄 [ArtifactService] Loaded fe-system-design.md (legacy)`);
        }
      }
    }
    
    // Load be-system-design.md (legacy single backend)
    if (shouldLoadBe && !result.beDesigns) {
      const beDesignPath = path.join(designPath, 'be-system-design.md');
      if (await fileSystem.fileExists(beDesignPath)) {
        const content = await fileSystem.readFile(beDesignPath);
        if (content) {
          result.beDesign = content;
          console.log(`📄 [ArtifactService] Loaded be-system-design.md (legacy)`);
        }
      }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 4. Final fallback: system-design.md (unified)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const hasAnyDesign = result.feDesign || result.beDesign || 
                         result.feDesigns || result.beDesigns;
    
    if (!hasAnyDesign) {
      const unifiedPath = path.join(designPath, 'system-design.md');
      if (await fileSystem.fileExists(unifiedPath)) {
        const content = await fileSystem.readFile(unifiedPath);
        if (content) {
          result.unifiedDesign = content;
          console.log(`📄 [ArtifactService] Loaded system-design.md (unified fallback)`);
        }
      }
    }

    // Log summary
    const loadedCount = [
      result.apiContract ? 1 : 0,
      result.feDesign ? 1 : 0,
      result.beDesign ? 1 : 0,
      result.unifiedDesign ? 1 : 0,
      Object.keys(result.feDesigns || {}).length,
      Object.keys(result.beDesigns || {}).length,
    ].reduce((a, b) => a + b, 0);
    
    console.log(`📊 [ArtifactService] Total design documents loaded: ${loadedCount}`);
    if (result.feDesigns) console.log(`   - Frontend packages: ${Object.keys(result.feDesigns).join(', ')}`);
    if (result.beDesigns) console.log(`   - Backend services: ${Object.keys(result.beDesigns).join(', ')}`);

    return result;
  }

  /**
   * List design files in directory
   * Helper for scanning multi-package patterns
   */
  private static async listDesignFiles(
    fileSystem: FileSystemPort,
    designPath: string
  ): Promise<string[]> {
    try {
      // Use fileSystem to list directory contents
      const exists = await fileSystem.fileExists(designPath);
      if (!exists) return [];
      
      // Try to list directory - implementation depends on FileSystemPort capabilities
      const listDir = (fileSystem as any).listDirectory || (fileSystem as any).readdir;
      if (listDir) {
        const files = await listDir.call(fileSystem, designPath);
        return files.filter((f: string) => f.endsWith('.md'));
      }
      
      // Fallback: check known patterns manually
      const knownPatterns = [
        'api-contract.md',
        'fe-system-design.md',
        'be-system-design.md',
        'system-design.md',
      ];
      
      // Also check common service names for MSA
      const commonServices = ['auth', 'user', 'order', 'payment', 'product', 'notification', 'gateway'];
      const commonFePkgs = ['web', 'admin', 'mobile', 'shared-ui', 'common'];
      
      for (const svc of commonServices) {
        knownPatterns.push(`be-system-design-${svc}.md`);
      }
      for (const pkg of commonFePkgs) {
        knownPatterns.push(`fe-system-design-${pkg}.md`);
      }
      
      const existing: string[] = [];
      for (const pattern of knownPatterns) {
        const filePath = path.join(designPath, pattern);
        if (await fileSystem.fileExists(filePath)) {
          existing.push(pattern);
        }
      }
      
      return existing;
    } catch (error) {
      console.warn(`⚠️  [ArtifactService] Failed to list design files:`, error);
      return [];
    }
  }

  /**
   * Write report file (실행 로그는 sessions/debug/logs로 이동)
   */
  static async writeReportFile(
    context: ProjectContext,
    fileName: string,
    content: string,
    gitPort: GitPort,
    fileSystem: FileSystemPort
  ): Promise<string> {
    const featurePathAbs = WorkspacePathResolver.resolveFeaturePath(context);
    const reportDirAbs = path.join(featurePathAbs, "sessions/debug/logs");
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

