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
import type { AgentJob } from "../../core/types/agent";
import {
  parseUiDocs,
  getUiSectionsForTask,
  getAllUiContent,
  generateUiSectionsSummary,
} from "./UiDocParser";
import { getSessionDebugDir } from "../../core/utils/sessionPaths";
import { normalizeTemplateDoc } from "../../core/utils/templateDetector";

/**
 * Artifact-specific project context.
 * Extends the core ProjectContext concept with artifact/feature-level fields.
 */
export interface ArtifactProjectContext {
  project: string;
  featureFolder: string;
  userId?: string;
  organizationId?: string;
  featurePath?: string;
  workspaceResolver?: any;
  [key: string]: any;
}

export class ArtifactService {
  /**
   * Treat "template/placeholder" docs as empty to avoid misleading prompts.
   * Delegates to the shared templateDetector utility.
   */
  private static normalizeUserDoc(raw: string | null | undefined): string | null {
    return normalizeTemplateDoc(raw);
  }
  /**
   * FileSystemPort는 워크스페이스 루트 기준 "상대경로"만 허용한다.
   * 그런데 WorkspaceResolver/WorkspacePathResolver는 절대경로를 반환하므로,
   * 여기서 일관되게 상대경로로 변환해서 FileSystemPort에 전달한다.
   */
  private static toWorkspaceRelative(fileSystem: FileSystemPort, p: string): string {
    if (!p) return p;
    if (!path.isAbsolute(p)) return p;

    const root = fileSystem.getRootPath?.();
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
    context: ArtifactProjectContext,
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
   * Get source materials from inputs/sources/.
   * Reads ALL text files as structured sourceDocuments (filename -> content).
   * prd field is kept for backward compatibility (= sourceDocuments["prd.md"]).
   */
  static async getSource(
    context: ArtifactProjectContext,
    gitPort: GitPort,
    fileSystem: FileSystemPort
  ): Promise<{
    prd?: string;
    sourceDocuments?: Record<string, string>;
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

    // 1. Read all text files as sourceDocuments
    const textExtensions = [".md", ".txt", ".json", ".yaml", ".yml", ".csv", ".xml", ".html"];
    const imageExtensions = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"];
    const sourceDocuments: Record<string, string> = {};

    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const nameLower = entry.name.toLowerCase();
      if (imageExtensions.some(ext => nameLower.endsWith(ext))) continue;
      if (!textExtensions.some(ext => nameLower.endsWith(ext))) continue;

      const filePath = path.join(sourceDir, entry.name);
      const content = await fileSystem.readFile(filePath);
      const normalized = ArtifactService.normalizeUserDoc(content);
      if (normalized) {
        sourceDocuments[entry.name] = normalized;
      }
    }

    if (Object.keys(sourceDocuments).length > 0) {
      result.sourceDocuments = sourceDocuments;
      result.prd = sourceDocuments["prd.md"] || undefined;
      const fileNames = Object.keys(sourceDocuments);
      console.log(`📄 [Source] Loaded ${fileNames.length} source file(s): ${fileNames.join(', ')}`);
    }

    // 2. Wireframes (images) - legacy: direct images in inputs/sources/
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
    context: ArtifactProjectContext,
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
   * Reference images for UI.
   * Returns file paths under inputs/references/ (recursive) if they exist.
   */
  static async loadUiReferenceImages(
    context: ArtifactProjectContext,
    fileSystem: FileSystemPort
  ): Promise<string[] | undefined> {
    const featurePathAbs = context.featurePath || WorkspacePathResolver.resolveFeaturePath(context);
    const inputsDirAbs = path.join(featurePathAbs, "inputs");
    const inputsDir = ArtifactService.toWorkspaceRelative(fileSystem, inputsDirAbs);

    const referencesDir = path.join(inputsDir, 'references');
    const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

    const collectImages = async (dir: string): Promise<string[]> => {
      if (!(await fileSystem.fileExists(dir))) return [];
      const entries = await fileSystem.readDirectory(dir);
      const results: string[] = [];

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory) {
          results.push(...(await collectImages(fullPath)));
        } else {
          const ext = path.extname(entry.name).toLowerCase();
          if (IMAGE_EXTS.includes(ext) && entry.name.toLowerCase() !== 'readme.md') {
            results.push(fullPath);
          }
        }
      }
      return results;
    };

    const files = (await collectImages(referencesDir)).sort();
    return files.length > 0 ? files : undefined;
  }

  /**
   * Find latest design document by scanning for unified `{type}-{name}.md` patterns.
   * Returns the first matching file's content and path.
   */
  static async findLatestDesign(
    context: ArtifactProjectContext,
    gitPort: GitPort,
    fileSystem: FileSystemPort,
    preferredEnvironment?: 'frontend' | 'backend' | 'any'
  ): Promise<{ content: string; filePath: string } | null> {
    const featurePathAbs = WorkspacePathResolver.resolveFeaturePath(context);
    const designPathAbs = path.join(featurePathAbs, "outputs/design");
    const designPath = ArtifactService.toWorkspaceRelative(fileSystem, designPathAbs);

    console.log(`🔍 [ArtifactService.findLatestDesign] designPath: ${designPath}`);

    const designFiles = await ArtifactService.listDesignFiles(fileSystem, designPath);

    const priorityPatterns: RegExp[] = [];
    if (preferredEnvironment === 'frontend') {
      priorityPatterns.push(/^fe-system-.+\.md$/, /^api-contract-.+\.md$/, /^be-system-.+\.md$/);
    } else if (preferredEnvironment === 'backend') {
      priorityPatterns.push(/^be-system-.+\.md$/, /^api-contract-.+\.md$/, /^fe-system-.+\.md$/);
    } else {
      priorityPatterns.push(/^fe-system-.+\.md$/, /^be-system-.+\.md$/, /^api-contract-.+\.md$/);
    }

    for (const pattern of priorityPatterns) {
      const match = designFiles.find(f => pattern.test(f));
      if (match) {
        const filePath = path.join(designPath, match);
        const content = await fileSystem.readFile(filePath);
        if (content) {
          console.log(`📄 [ArtifactService] Found design document: ${match}`);
          return { content, filePath: match };
        }
      }
    }

    return null;
  }

  /**
   * Design Documents Result Type — unified map-only structure.
   * All design docs use `{type}-{name}.md` pattern.
   */
  static readonly DesignDocsResultType = {} as {
    apiContracts: { [name: string]: string };
    feDesigns: { [name: string]: string };
    beDesigns: { [name: string]: string };
  };

  /**
   * Load design documents for Code Job.
   * 
   * Scans outputs/design/ for unified `{type}-{name}.md` pattern only:
   *   - api-contract-{name}.md
   *   - fe-system-{name}.md
   *   - be-system-{name}.md
   */
  static async loadDesignDocuments(
    context: ArtifactProjectContext,
    gitPort: GitPort,
    fileSystem: FileSystemPort,
    environment?: 'frontend' | 'backend' | 'fullstack' | 'unknown'
  ): Promise<typeof ArtifactService.DesignDocsResultType> {
    const featurePathAbs = WorkspacePathResolver.resolveFeaturePath(context);
    const designPathAbs = path.join(featurePathAbs, "outputs/design");
    const designPath = ArtifactService.toWorkspaceRelative(fileSystem, designPathAbs);
    
    console.log(`🔍 [ArtifactService.loadDesignDocuments] designPath: ${designPath}`);
    
    const result: typeof ArtifactService.DesignDocsResultType = {
      apiContracts: {},
      feDesigns: {},
      beDesigns: {},
    };

    const designFiles = await ArtifactService.listDesignFiles(fileSystem, designPath);
    
    const apiContractPattern = /^api-contract-(.+)\.md$/;
    const fePattern = /^fe-system-(.+)\.md$/;
    const bePattern = /^be-system-(.+)\.md$/;
    
    for (const file of designFiles) {
      const apiMatch = file.match(apiContractPattern);
      if (apiMatch) {
        const filePath = path.join(designPath, file);
        const content = await fileSystem.readFile(filePath);
        if (content) {
          result.apiContracts[apiMatch[1]] = content;
          console.log(`📄 [ArtifactService] Loaded api-contract-${apiMatch[1]}.md`);
        }
        continue;
      }
      
      const feMatch = file.match(fePattern);
      if (feMatch) {
        const filePath = path.join(designPath, file);
        const content = await fileSystem.readFile(filePath);
        if (content) {
          result.feDesigns[feMatch[1]] = content;
          console.log(`📄 [ArtifactService] Loaded fe-system-${feMatch[1]}.md`);
        }
        continue;
      }
      
      const beMatch = file.match(bePattern);
      if (beMatch) {
        const filePath = path.join(designPath, file);
        const content = await fileSystem.readFile(filePath);
        if (content) {
          result.beDesigns[beMatch[1]] = content;
          console.log(`📄 [ArtifactService] Loaded be-system-${beMatch[1]}.md`);
        }
      }
    }

    const loadedCount = Object.keys(result.apiContracts).length
      + Object.keys(result.feDesigns).length
      + Object.keys(result.beDesigns).length;
    
    console.log(`📊 [ArtifactService] Total design documents loaded: ${loadedCount}`);
    if (Object.keys(result.apiContracts).length) console.log(`   - API contracts: ${Object.keys(result.apiContracts).join(', ')}`);
    if (Object.keys(result.feDesigns).length) console.log(`   - Frontend packages: ${Object.keys(result.feDesigns).join(', ')}`);
    if (Object.keys(result.beDesigns).length) console.log(`   - Backend services: ${Object.keys(result.beDesigns).join(', ')}`);

    return result;
  }

  /**
   * Load spec documents (spec-{slug}.md) from outputs/design/
   * 
   * Spec docs are feature/task-scoped specifications generated by Design Job (workType: 'spec').
   * Code Job loads all spec docs at resolve, then decompose LLM selects the relevant one.
   * 
   * @returns Record<filename, content> (e.g., { "spec-social-login.md": "# Spec: ..." })
   */
  static async loadSpecDocuments(
    context: ArtifactProjectContext,
    gitPort: GitPort,
    fileSystem: FileSystemPort
  ): Promise<Record<string, string>> {
    const featurePathAbs = WorkspacePathResolver.resolveFeaturePath(context);
    const designPathAbs = path.join(featurePathAbs, "outputs/design");
    const designPath = ArtifactService.toWorkspaceRelative(fileSystem, designPathAbs);

    const specDocs: Record<string, string> = {};
    const SPEC_PATTERN = /^spec-.+\.md$/;

    try {
      const exists = await fileSystem.fileExists(designPath);
      if (!exists) return specDocs;

      const entries = await fileSystem.readDirectory(designPath);
      for (const entry of entries) {
        if (entry.isDirectory || !SPEC_PATTERN.test(entry.name)) continue;
        const filePath = path.join(designPath, entry.name);
        const content = await fileSystem.readFile(filePath);
        if (content) {
          specDocs[entry.name] = content;
          console.log(`📋 [ArtifactService] Loaded spec doc: ${entry.name}`);
        }
      }
    } catch (error) {
      console.error(`❌ [ArtifactService] Failed to load spec documents:`, error);
    }

    if (Object.keys(specDocs).length > 0) {
      console.log(`📊 [ArtifactService] Total spec documents loaded: ${Object.keys(specDocs).length}`);
    }

    return specDocs;
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
      const exists = await fileSystem.fileExists(designPath);
      if (!exists) return [];
      
      const entries = await fileSystem.readDirectory(designPath);
      return entries
        .filter(e => !e.isDirectory && e.name.endsWith('.md'))
        .map(e => e.name);
    } catch (error) {
      console.error(`❌ [ArtifactService] Failed to list design files at ${designPath}:`, error);
      return [];
    }
  }

  /**
   * Write report file (실행 로그는 sessions/debug/logs로 이동)
   */
  static async writeReportFile(
    context: ArtifactProjectContext,
    fileName: string,
    content: string,
    gitPort: GitPort,
    fileSystem: FileSystemPort
  ): Promise<string> {
    const featurePathAbs = WorkspacePathResolver.resolveFeaturePath(context);
    const reportDirAbs = getSessionDebugDir(featurePathAbs, 'architect', 'logs');
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
    context: ArtifactProjectContext,
    content: string,
    gitPort: GitPort,
    fileSystem: FileSystemPort
  ): Promise<string> {
    const featurePathAbs = WorkspacePathResolver.resolveFeaturePath(context);
    const designDirAbs = path.join(featurePathAbs, "outputs/design");
    const designDir = ArtifactService.toWorkspaceRelative(fileSystem, designDirAbs);
    await fileSystem.createDirectory(designDir);
    
    const timestamp = Date.now();
    const fileName = `design-${context.project}-${timestamp}.md`;
    const designFile = path.join(designDir, fileName);
    await fileSystem.writeFile(designFile, content);
    
    return designFile;
  }
}

