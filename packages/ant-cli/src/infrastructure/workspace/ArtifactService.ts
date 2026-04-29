/**
 * Artifact Service
 *
 * Feature 개발 과정의 입출력 artifact 파일 관리 (도메인 트리)
 * - meta/directives/: 작업 지시사항
 * - plan/: PRD / GDD 등 입력 자료 (depth -1, 파일 직속)
 * - architecture/{system,spec}/: 시스템 설계 문서 (system .md / spec .md)
 * - visual/{ui,game-art}/{ant,figma,handoff}/: UI / 게임 아트 디자인 산출물
 * - meta/evals/: 평가 리포트
 *
 * ✅ Hexagonal Architecture:
 * - FileSystemPort를 통한 파일 I/O (테스트 가능)
 * - WorkspacePathResolver로 경로 계산
 */

import * as path from "path";
import { GitPort, FileSystemPort } from "../../core/ports";
import { WorkspacePathResolver } from "../../core/config/WorkspacePathResolver";
import { ParsedDesignDocs } from "../../core/types/designDoc";
import type { AgentJob } from "../../core/types/agent";
import {
  parseUiDocs,
  parseGameArtDocs,
  generateUiSectionsSummary,
} from "./DesignDocParser";
import { normalizeTemplateDoc } from "../../core/utils/templateDetector";
import { ARTIFACT_PREFIX } from "@ant/shared";

// Trim trailing slashes so the constant is composable with `path.join`.
const ARCHITECTURE_SYSTEM_DIR = ARTIFACT_PREFIX.SYSTEM_DESIGN.replace(/\/$/, '');
const ARCHITECTURE_SPEC_DIR = ARTIFACT_PREFIX.SPEC.replace(/\/$/, '');
const VISUAL_UI_ANT_DIR = ARTIFACT_PREFIX.UI_ANT.replace(/\/$/, '');
const VISUAL_UI_HANDOFF_DIR = ARTIFACT_PREFIX.UI_HANDOFF.replace(/\/$/, '');
const VISUAL_GAME_ART_ANT_DIR = ARTIFACT_PREFIX.GAME_ART_ANT.replace(/\/$/, '');
const PLAN_DIR = ARTIFACT_PREFIX.SOURCES;
const META_DIRECTIVES_DIR = 'meta/directives';

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
   * - /workspaces/org/user/project/features/skeleton/plan/prd.md → "skeleton"
   * - /workspaces/local/user/test-app/features/my-feature/plan/prd.md → "my-feature"
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
    const directiveDirAbs = path.join(featurePathAbs, META_DIRECTIVES_DIR, job);
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
   * Get source materials from `plan/`.
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
    const sourceDirAbs = path.join(featurePathAbs, PLAN_DIR);
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

    // 2. Wireframes (images) - legacy: direct images in `plan/`
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
  /**
   * Read a UI document from the canonical ant UiSource location
   * (`visual/ui/ant/<file>`). Other UiSource kinds (figma / handoff)
   * are NOT read here — they are handled via the RAC pool or via MCP at
   * execute time.
   */
  private static async readUiFile(
    fileSystem: FileSystemPort,
    uiAntDir: string,
    fileName: string
  ): Promise<string | undefined> {
    const subPath = path.join(uiAntDir, fileName);
    if (await fileSystem.fileExists(subPath)) {
      const content = await fileSystem.readFile(subPath);
      return ArtifactService.normalizeUserDoc(content) || undefined;
    }
    return undefined;
  }

  static async loadParsedUiContext(
    context: ArtifactProjectContext,
    gitPort: GitPort,
    fileSystem: FileSystemPort
  ): Promise<ParsedDesignDocs | null> {
    const featurePathAbs = context.featurePath || WorkspacePathResolver.resolveFeaturePath(context);
    const uiAntDirAbs = path.join(featurePathAbs, VISUAL_UI_ANT_DIR);
    const uiAntDir = ArtifactService.toWorkspaceRelative(fileSystem, uiAntDirAbs);

    const uiAntDirExists = await fileSystem.fileExists(uiAntDir);
    if (!uiAntDirExists) {
      console.log(`⚠️  [ArtifactService] loadParsedUiContext: ui ant dir not found: ${uiAntDir}`);
      return null;
    }

    const uiSpec = await ArtifactService.readUiFile(fileSystem, uiAntDir, 'ui-spec.json');
    if (uiSpec) console.log(`   ✅ [loadParsedUiContext] ui-spec.json: loaded (${uiSpec.length} chars)`);

    const uiTokens = await ArtifactService.readUiFile(fileSystem, uiAntDir, 'ui-tokens.json');
    if (uiTokens) console.log(`   ✅ [loadParsedUiContext] ui-tokens.json: loaded (${uiTokens.length} chars)`);

    const uiAssets = await ArtifactService.readUiFile(fileSystem, uiAntDir, 'ui-assets.json');
    if (uiAssets) console.log(`   ✅ [loadParsedUiContext] ui-assets.json: loaded (${uiAssets.length} chars)`);

    if (!uiSpec && !uiTokens && !uiAssets) {
      console.log(`   ⚠️  [loadParsedUiContext] No UI documents found`);
      return null;
    }

    const parsed = parseUiDocs(uiSpec, uiTokens, uiAssets);

    console.log(`   📊 [loadParsedUiContext] Parsed UI docs:`);
    console.log(`      - Tokens: ${parsed.tokensTokenEstimate || 0} estimated tokens`);
    console.log(`      - Assets: ${parsed.assetsTokenEstimate || 0} estimated tokens`);
    console.log(`      - Spec sections: ${parsed.specSections.size} sections, ~${parsed.specTotalTokens} tokens total`);

    return parsed;
  }

  /**
   * Read a GameArt document from the canonical sub-sourced location
   * (`visual/game-art/ant/<file>`). D24-revised v8 — game-art mirrors UI's
   * sub-source split (`ant/` is the LLM-generated canonical;
   * `figma/`/`handoff/` are Phase 5+ hooks). 단방향 원칙: `ant/` canonical
   * 만 읽으며, sub-source 미적용 flat 경로에 대한 fallback 분기는 두지
   * 않는다.
   */
  private static async readGameArtFile(
    fileSystem: FileSystemPort,
    gameArtAntDir: string,
    fileName: string,
  ): Promise<string | undefined> {
    const antPath = path.join(gameArtAntDir, fileName);
    if (await fileSystem.fileExists(antPath)) {
      const content = await fileSystem.readFile(antPath);
      return ArtifactService.normalizeUserDoc(content) || undefined;
    }
    return undefined;
  }

  /**
   * Load GameArt documents (`game-art-tokens` / `game-art-assets` /
   * `game-art-spec`) from `visual/game-art/ant/` (D24-revised v8 —
   * sub-sourced canonical) and parse them into the same `ParsedDesignDocs`
   * shape used for UI, with `surface: 'gameArt'` so downstream prompts know
   * to interpret spec sub-sections as category dictionary keys (D25).
   *
   * Returns `null` if the directory or all three files are absent —
   * matching `loadParsedUiContext`'s contract.
   */
  static async loadParsedGameArtContext(
    context: ArtifactProjectContext,
    _gitPort: GitPort,
    fileSystem: FileSystemPort,
  ): Promise<ParsedDesignDocs | null> {
    const featurePathAbs = context.featurePath || WorkspacePathResolver.resolveFeaturePath(context);
    const gameArtAntDirAbs = path.join(featurePathAbs, VISUAL_GAME_ART_ANT_DIR);
    const gameArtAntDir = ArtifactService.toWorkspaceRelative(fileSystem, gameArtAntDirAbs);

    const gameArtAntDirExists = await fileSystem.fileExists(gameArtAntDir);
    if (!gameArtAntDirExists) {
      console.log(`⚠️  [ArtifactService] loadParsedGameArtContext: game-art ant dir not found: ${gameArtAntDir}`);
      return null;
    }

    const spec = await ArtifactService.readGameArtFile(fileSystem, gameArtAntDir, 'game-art-spec.json');
    if (spec) console.log(`   ✅ [loadParsedGameArtContext] game-art-spec.json: loaded (${spec.length} chars)`);

    const tokens = await ArtifactService.readGameArtFile(fileSystem, gameArtAntDir, 'game-art-tokens.json');
    if (tokens) console.log(`   ✅ [loadParsedGameArtContext] game-art-tokens.json: loaded (${tokens.length} chars)`);

    const assets = await ArtifactService.readGameArtFile(fileSystem, gameArtAntDir, 'game-art-assets.json');
    if (assets) console.log(`   ✅ [loadParsedGameArtContext] game-art-assets.json: loaded (${assets.length} chars)`);

    if (!spec && !tokens && !assets) {
      console.log(`   ⚠️  [loadParsedGameArtContext] No GameArt documents found`);
      return null;
    }

    const parsed = parseGameArtDocs(spec, tokens, assets);

    console.log(`   📊 [loadParsedGameArtContext] Parsed GameArt docs:`);
    console.log(`      - Tokens: ${parsed.tokensTokenEstimate || 0} estimated tokens`);
    console.log(`      - Assets: ${parsed.assetsTokenEstimate || 0} estimated tokens`);
    console.log(`      - Spec categories: ${parsed.specSections.size} sections, ~${parsed.specTotalTokens} tokens total`);

    return parsed;
  }

  /**
   * @deprecated Use ArtifactPipeline + resolveArtifacts() instead.
   * Kept only for backward compatibility with design job (Phase 3 migration).
   */
  static getUiSectionsSummary(parsedDocs: ParsedDesignDocs): string {
    return generateUiSectionsSummary(parsedDocs);
  }

  /**
   * Inline image candidates for the code job's multimodal channel.
   *
   * Reads `visual/ui/handoff/**` and returns image paths
   * (`.png/.jpg/.jpeg/.webp/.gif/.svg`). Handoff is a free-form file
   * bundle (FPOP — observe only, no schema inference), so any image it
   * contains is a legitimate "what the screen should look like" hint.
   * Other UI sources are NOT scanned: `ant` is JSON-only and `figma` is
   * URL-only / fetched via MCP.
   */
  static async loadHandoffImages(
    context: ArtifactProjectContext,
    fileSystem: FileSystemPort,
  ): Promise<string[] | undefined> {
    const featurePathAbs = context.featurePath || WorkspacePathResolver.resolveFeaturePath(context);
    const handoffDirAbs = path.join(featurePathAbs, VISUAL_UI_HANDOFF_DIR);
    const handoffDir = ArtifactService.toWorkspaceRelative(fileSystem, handoffDirAbs);

    const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'];

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

    const files = (await collectImages(handoffDir)).sort();
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
    const systemPathAbs = path.join(featurePathAbs, ARCHITECTURE_SYSTEM_DIR);
    const systemPath = ArtifactService.toWorkspaceRelative(fileSystem, systemPathAbs);

    console.log(`🔍 [ArtifactService.findLatestDesign] systemPath: ${systemPath}`);

    const SYSTEM_PATTERN = /^(api-contract|fe-system|be-system)-.+\.md$/;
    const designFiles = await ArtifactService.listDesignFiles(
      fileSystem, systemPath, n => SYSTEM_PATTERN.test(n)
    );

    const priorityPatterns: RegExp[] = [];
    if (preferredEnvironment === 'frontend') {
      priorityPatterns.push(/^fe-system-.+\.md$/, /^api-contract-.+\.md$/, /^be-system-.+\.md$/);
    } else if (preferredEnvironment === 'backend') {
      priorityPatterns.push(/^be-system-.+\.md$/, /^api-contract-.+\.md$/, /^fe-system-.+\.md$/);
    } else {
      priorityPatterns.push(/^fe-system-.+\.md$/, /^be-system-.+\.md$/, /^api-contract-.+\.md$/);
    }

    for (const pattern of priorityPatterns) {
      const match = designFiles.find(f => pattern.test(f.name));
      if (match) {
        const filePath = path.join(match.dir, match.name);
        const content = await fileSystem.readFile(filePath);
        if (content) {
          console.log(`📄 [ArtifactService] Found design document: ${match.name}`);
          return { content, filePath: match.name };
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
   * Scans `architecture/system/` for system-tier markdown documents.
   * Patterns: api-contract-{name}.md, fe-system-{name}.md, be-system-{name}.md
   */
  static async loadDesignDocuments(
    context: ArtifactProjectContext,
    gitPort: GitPort,
    fileSystem: FileSystemPort,
    environment?: 'frontend' | 'backend' | 'fullstack' | 'unknown'
  ): Promise<typeof ArtifactService.DesignDocsResultType> {
    const featurePathAbs = WorkspacePathResolver.resolveFeaturePath(context);
    const systemPathAbs = path.join(featurePathAbs, ARCHITECTURE_SYSTEM_DIR);
    const systemPath = ArtifactService.toWorkspaceRelative(fileSystem, systemPathAbs);

    console.log(`🔍 [ArtifactService.loadDesignDocuments] systemPath: ${systemPath}`);

    const result: typeof ArtifactService.DesignDocsResultType = {
      apiContracts: {},
      feDesigns: {},
      beDesigns: {},
    };

    const SYSTEM_PATTERN = /^(api-contract|fe-system|be-system)-.+\.md$/;
    const designFiles = await ArtifactService.listDesignFiles(
      fileSystem, systemPath, n => SYSTEM_PATTERN.test(n)
    );
    
    const apiContractPattern = /^api-contract-(.+)\.md$/;
    const fePattern = /^fe-system-(.+)\.md$/;
    const bePattern = /^be-system-(.+)\.md$/;
    
    for (const { name: file, dir } of designFiles) {
      const filePath = path.join(dir, file);

      const apiMatch = file.match(apiContractPattern);
      if (apiMatch) {
        const content = await fileSystem.readFile(filePath);
        if (content) {
          result.apiContracts[apiMatch[1]] = content;
          console.log(`📄 [ArtifactService] Loaded api-contract-${apiMatch[1]}.md`);
        }
        continue;
      }
      
      const feMatch = file.match(fePattern);
      if (feMatch) {
        const content = await fileSystem.readFile(filePath);
        if (content) {
          result.feDesigns[feMatch[1]] = content;
          console.log(`📄 [ArtifactService] Loaded fe-system-${feMatch[1]}.md`);
        }
        continue;
      }
      
      const beMatch = file.match(bePattern);
      if (beMatch) {
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
   * Load spec documents (spec-{slug}.md).
   *
   * Scans `architecture/spec/` for feature-scoped specifications generated
   * by Design Job (intentGroup: 'design-spec'). Code Job loads all spec
   * docs at resolve, then decompose LLM selects the relevant one.
   *
   * @returns Record<filename, content> (e.g., { "spec-social-login.md": "# Spec: ..." })
   */
  static async loadSpecDocuments(
    context: ArtifactProjectContext,
    gitPort: GitPort,
    fileSystem: FileSystemPort
  ): Promise<Record<string, string>> {
    const featurePathAbs = WorkspacePathResolver.resolveFeaturePath(context);
    const specPathAbs = path.join(featurePathAbs, ARCHITECTURE_SPEC_DIR);
    const specPath = ArtifactService.toWorkspaceRelative(fileSystem, specPathAbs);

    const specDocs: Record<string, string> = {};
    const SPEC_PATTERN = /^spec-.+\.md$/;

    try {
      const specFiles = await ArtifactService.listDesignFiles(
        fileSystem, specPath, n => SPEC_PATTERN.test(n)
      );

      for (const { name, dir } of specFiles) {
        const filePath = path.join(dir, name);
        const content = await fileSystem.readFile(filePath);
        if (content) {
          specDocs[name] = content;
          console.log(`📋 [ArtifactService] Loaded spec doc: ${name}`);
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
   * List files in a directory matching an optional filter.
   * Returns filenames (not paths).
   */
  private static async listFilesIn(
    fileSystem: FileSystemPort,
    dirPath: string,
    filter?: (name: string) => boolean
  ): Promise<string[]> {
    try {
      const exists = await fileSystem.fileExists(dirPath);
      if (!exists) return [];

      const entries = await fileSystem.readDirectory(dirPath);
      let names = entries.filter(e => !e.isDirectory).map(e => e.name);
      if (filter) names = names.filter(filter);
      return names;
    } catch (error) {
      console.error(`❌ [ArtifactService] Failed to list files at ${dirPath}:`, error);
      return [];
    }
  }

  /**
   * List design files in directory.
   * 단방향 원칙: 단일 디렉토리만 스캔. legacy flat fallback 분기는 두지 않는다.
   */
  private static async listDesignFiles(
    fileSystem: FileSystemPort,
    dirPath: string,
    filter?: (name: string) => boolean
  ): Promise<{ name: string; dir: string }[]> {
    const names = await ArtifactService.listFilesIn(
      fileSystem,
      dirPath,
      filter ?? ((n: string) => n.endsWith('.md')),
    );
    return names.map(name => ({ name, dir: dirPath }));
  }

  /**
   * Write a fallback system-design markdown document.
   *
   * 도메인 트리: `architecture/system/` 하위에 timestamped 파일을 작성한다.
   */
  static async writeDesignDocument(
    context: ArtifactProjectContext,
    content: string,
    gitPort: GitPort,
    fileSystem: FileSystemPort
  ): Promise<string> {
    const featurePathAbs = WorkspacePathResolver.resolveFeaturePath(context);
    const systemDirAbs = path.join(featurePathAbs, ARCHITECTURE_SYSTEM_DIR);
    const systemDir = ArtifactService.toWorkspaceRelative(fileSystem, systemDirAbs);
    await fileSystem.createDirectory(systemDir);

    const timestamp = Date.now();
    const fileName = `design-${context.project}-${timestamp}.md`;
    const designFile = path.join(systemDir, fileName);
    await fileSystem.writeFile(designFile, content);

    return designFile;
  }
}

