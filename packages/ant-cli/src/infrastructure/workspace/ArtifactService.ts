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
 * - GitPort를 통한 파일 I/O (테스트 가능)
 * - WorkspacePathResolver로 경로 계산
 */

import * as path from "path";
import { GitPort } from "../../core/ports";
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
    gitPort: GitPort
  ): Promise<string | null> {
    const featurePath = WorkspacePathResolver.resolveFeaturePath(context);
    const directiveDir = path.join(featurePath, "inputs/directives", task);

    const exists = await gitPort.fileExists(directiveDir);
    if (!exists) {
      return null;
    }

    // 1. Check directive.md (default)
    const defaultPath = path.join(directiveDir, "directive.md");
    const defaultExists = await gitPort.fileExists(defaultPath);
    if (defaultExists) {
      const content = await gitPort.readFile(defaultPath);
      if (content && content.trim().length > 0) {
        return content.trim();
      }
    }

    // 2. Find latest directive-nnn.md
    const entries = await gitPort.readDirectory(directiveDir);
    const files = entries
      .filter(e => !e.isDirectory && /^directive-\d+\.md$/.test(e.name))
      .map(e => {
        const match = e.name.match(/^directive-(\d+)\.md$/);
        return match ? { name: e.name, number: parseInt(match[1]) } : null;
      })
      .filter((item): item is { name: string; number: number } => item !== null)
      .sort((a, b) => b.number - a.number);

    if (files.length > 0) {
      const content = await gitPort.readFile(path.join(directiveDir, files[0].name));
      if (content && content.trim().length > 0) {
        return content.trim();
      }
    }

    return null;
  }

  /**
   * Get source materials (PRD + all resources)
   */
  static async getSource(
    context: ProjectContext,
    gitPort: GitPort
  ): Promise<{
    prd?: string;
    figmaLink?: string;
    figmaData?: any;
    wireframes?: string[];
  }> {
    const result: any = {};
    
    const featurePath = WorkspacePathResolver.resolveFeaturePath(context);
    const sourceDir = path.join(featurePath, "inputs/sources");
    
    const sourceDirExists = await gitPort.fileExists(sourceDir);
    if (!sourceDirExists) {
      return result;
    }

    const entries = await gitPort.readDirectory(sourceDir);

    // 1. PRD (combined or individual files)
    const combinedPrd = path.join(sourceDir, ".combined-prd.tmp.md");
    if (await gitPort.fileExists(combinedPrd)) {
      result.prd = await gitPort.readFile(combinedPrd);
    } else {
      const prdFiles = entries
        .filter(e => !e.isDirectory && e.name.endsWith(".md") && e.name !== ".combined-prd.tmp.md")
        .map(e => e.name)
        .sort();

      if (prdFiles.length > 0) {
        const prdContents = await Promise.all(
          prdFiles.map(async (file) => {
            const content = await gitPort.readFile(path.join(sourceDir, file));
            return `# ${file}\n\n${content}`;
          })
        );
        result.prd = prdContents.join("\n\n---\n\n");
      }
    }

    // 2. Wireframes (images)
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
    preferredEnvironment?: 'frontend' | 'backend' | 'any'
  ): Promise<{ content: string; filePath: string } | null> {
    const featurePath = WorkspacePathResolver.resolveFeaturePath(context);
    const designPath = path.join(featurePath, "outputs/design");

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
    const exists = await gitPort.fileExists(designFilePath);

      if (exists) {
        const content = await gitPort.readFile(designFilePath);
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
    environment?: 'frontend' | 'backend' | 'unknown'
  ): Promise<{
    apiContract?: string;
    feDesign?: string;
    beDesign?: string;
    unifiedDesign?: string;
  }> {
    const featurePath = WorkspacePathResolver.resolveFeaturePath(context);
    const designPath = path.join(featurePath, "outputs/design");
    
    const result: {
      apiContract?: string;
      feDesign?: string;
      beDesign?: string;
      unifiedDesign?: string;
    } = {};

    // ✅ ALWAYS try to load api-contract.md (if exists)
    const apiContractPath = path.join(designPath, 'api-contract.md');
    if (await gitPort.fileExists(apiContractPath)) {
      const content = await gitPort.readFile(apiContractPath);
      if (content) {
        result.apiContract = content;
        console.log(`📄 [ArtifactService] Loaded api-contract.md for ${environment || 'unknown'} environment`);
      }
    }

    // ✅ Load environment-specific design documents
    if (environment === 'frontend') {
      // Frontend: Load fe-system-design.md or fallback to system-design.md
      const feDesignPath = path.join(designPath, 'fe-system-design.md');
      if (await gitPort.fileExists(feDesignPath)) {
        const content = await gitPort.readFile(feDesignPath);
        if (content) {
          result.feDesign = content;
          console.log(`📄 [ArtifactService] Loaded fe-system-design.md`);
        }
      } else {
        // Fallback: system-design.md
        const unifiedPath = path.join(designPath, 'system-design.md');
        if (await gitPort.fileExists(unifiedPath)) {
          const content = await gitPort.readFile(unifiedPath);
          if (content) {
            result.unifiedDesign = content;
            console.log(`📄 [ArtifactService] Loaded system-design.md (frontend fallback)`);
          }
        }
      }
    } else if (environment === 'backend') {
      // Backend: Load be-system-design.md or fallback to system-design.md
      const beDesignPath = path.join(designPath, 'be-system-design.md');
      if (await gitPort.fileExists(beDesignPath)) {
        const content = await gitPort.readFile(beDesignPath);
        if (content) {
          result.beDesign = content;
          console.log(`📄 [ArtifactService] Loaded be-system-design.md`);
        }
      } else {
        // Fallback: system-design.md
        const unifiedPath = path.join(designPath, 'system-design.md');
        if (await gitPort.fileExists(unifiedPath)) {
          const content = await gitPort.readFile(unifiedPath);
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
      
      if (await gitPort.fileExists(feDesignPath)) {
        const content = await gitPort.readFile(feDesignPath);
        if (content) {
          result.feDesign = content;
          console.log(`📄 [ArtifactService] Loaded fe-system-design.md (unknown env)`);
        }
      }
      
      if (await gitPort.fileExists(beDesignPath)) {
        const content = await gitPort.readFile(beDesignPath);
        if (content) {
          result.beDesign = content;
          console.log(`📄 [ArtifactService] Loaded be-system-design.md (unknown env)`);
        }
      }
      
      if (await gitPort.fileExists(unifiedPath)) {
        const content = await gitPort.readFile(unifiedPath);
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
    gitPort: GitPort
  ): Promise<string> {
    const featurePath = WorkspacePathResolver.resolveFeaturePath(context);
    const reportDir = path.join(featurePath, "outputs/reports");
    await gitPort.createDirectory(reportDir);
    
    const reportFile = path.join(reportDir, fileName);
    await gitPort.writeFile(reportFile, content);
    
    return reportFile;
  }

  /**
   * Write design document
   */
  static async writeDesignDocument(
    context: ProjectContext,
    content: string,
    gitPort: GitPort
  ): Promise<string> {
    const featurePath = WorkspacePathResolver.resolveFeaturePath(context);
    const designDir = path.join(featurePath, "outputs/design");
    await gitPort.createDirectory(designDir);
    
    const timestamp = Date.now();
    const fileName = `system-design-${context.project}-${timestamp}.md`;
    const designFile = path.join(designDir, fileName);
    await gitPort.writeFile(designFile, content);
    
    return designFile;
  }
}

