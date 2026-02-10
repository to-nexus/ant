/**
 * Workspace Analyzer
 * 
 * 워크스페이스 상태를 분석하여 WorkspaceState 객체 생성
 * Triage 노드에서 Prerequisites 체크에 사용
 */

import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceState } from './types';
import { ProjectContext } from '../../../architect/types';
import { GitPort, MemoryPort } from '../../../../core/ports';
import { FileSystemPort } from '../../../../core/ports/filesystem';

/**
 * Template marker to detect placeholder files
 */
const TEMPLATE_MARKER = '<!-- ant:template -->';

/**
 * Check if file content is a template (placeholder)
 */
function isTemplateContent(content: string): boolean {
  return content.includes(TEMPLATE_MARKER);
}

/**
 * Count files in a directory (non-recursive by default)
 */
function countFilesInDir(dirPath: string, recursive = false): number {
  if (!fs.existsSync(dirPath)) return 0;
  
  let count = 0;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isFile()) {
      count++;
    } else if (recursive && entry.isDirectory()) {
      count += countFilesInDir(fullPath, true);
    }
  }
  
  return count;
}

/**
 * Check if directory has any files
 */
function hasFilesInDir(dirPath: string): boolean {
  return countFilesInDir(dirPath) > 0;
}

/**
 * Analyze workspace and return WorkspaceState
 */
export async function analyzeWorkspace(
  context: ProjectContext,
  deps?: {
    git?: GitPort;
    fileSystem?: FileSystemPort;
    memory?: MemoryPort;
    workspaceResolver?: any;
  }
): Promise<WorkspaceState> {
  // Get feature path
  let featurePath = context.featurePath;
  
  console.log(`📂 [WorkspaceAnalyzer] context.featurePath: ${featurePath || '(not set)'}`);
  console.log(`📂 [WorkspaceAnalyzer] context.project: ${context.project || '(not set)'}, context.featureFolder: ${(context as any).featureFolder || '(not set)'}`);
  
  if (!featurePath && deps?.workspaceResolver) {
    const userContext = {
      userId: context.userId || 'local',
      organizationId: context.organizationId || 'local',
      workspacePath: ''
    };
    featurePath = deps.workspaceResolver.getFeaturePath(
      userContext,
      context.project,
      context.featureFolder
    );
    console.log(`📂 [WorkspaceAnalyzer] Resolved via workspaceResolver: ${featurePath}`);
  }
  
  if (!featurePath) {
    console.warn('[WorkspaceAnalyzer] Could not determine feature path');
    return createEmptyWorkspaceState();
  }
  
  console.log(`📂 [WorkspaceAnalyzer] Final featurePath: ${featurePath}`);
  
  // Initialize state
  const state: WorkspaceState = {
    featurePath,
    hasPrd: false,
    hasDirective: false,
    hasScreens: false,
    hasComponents: false,
    hasAssets: false,
    hasSystemDesignDoc: false,
    hasUiDocs: false,
    hasDesignDoc: false,
    hasCodebase: false
  };
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Check inputs/sources (PRD)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const prdPath = path.join(featurePath, 'inputs', 'sources', 'prd.md');
  const prdExists = fs.existsSync(prdPath);
  console.log(`📄 [WorkspaceAnalyzer] PRD check: ${prdPath} → exists=${prdExists}`);
  if (prdExists) {
    const content = fs.readFileSync(prdPath, 'utf-8');
    const isTemplate = isTemplateContent(content);
    const hasContent = content.trim().length > 0;
    state.hasPrd = !isTemplate && hasContent;
    console.log(`📄 [WorkspaceAnalyzer] PRD content: length=${content.length}, isTemplate=${isTemplate}, hasContent=${hasContent}, hasPrd=${state.hasPrd}`);
    if (state.hasPrd) {
      state.prdPath = prdPath;
    }
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Check directives (design or code)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const designDirectivePath = path.join(featurePath, 'inputs', 'directives', 'design', 'directive.md');
  const codeDirectivePath = path.join(featurePath, 'inputs', 'directives', 'code', 'directive.md');
  
  for (const directivePath of [designDirectivePath, codeDirectivePath]) {
    if (fs.existsSync(directivePath)) {
      const content = fs.readFileSync(directivePath, 'utf-8');
      if (!isTemplateContent(content) && content.trim().length > 0) {
        state.hasDirective = true;
        state.directivePath = directivePath;
        break;
      }
    }
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Check references (for ui-design)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const screensPath = path.join(featurePath, 'inputs', 'references', 'screens');
  state.hasScreens = hasFilesInDir(screensPath);
  if (state.hasScreens) {
    state.screenCount = countFilesInDir(screensPath, true);
  }
  
  const componentsPath = path.join(featurePath, 'inputs', 'references', 'components');
  state.hasComponents = hasFilesInDir(componentsPath);
  if (state.hasComponents) {
    state.componentCount = countFilesInDir(componentsPath, true);
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Check assets
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const assetsPath = path.join(featurePath, 'inputs', 'assets');
  state.hasAssets = hasFilesInDir(assetsPath);
  if (state.hasAssets) {
    state.assetCount = countFilesInDir(assetsPath, true);
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Check design documents
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const designPath = path.join(featurePath, 'outputs', 'design');
  
  // System design - check for any *system-design*.md pattern
  // (system-design.md, fe-system-design.md, be-system-design.md, etc.)
  if (fs.existsSync(designPath)) {
    const files = fs.readdirSync(designPath);
    state.hasSystemDesignDoc = files.some(f => 
      f.includes('system-design') && f.endsWith('.md')
    );
  } else {
    state.hasSystemDesignDoc = false;
  }
  
  // UI docs (ui-tokens.json, ui-assets.json, ui-spec.json)
  const uiTokensPath = path.join(designPath, 'ui-tokens.json');
  const uiAssetsPath = path.join(designPath, 'ui-assets.json');
  const uiSpecPath = path.join(designPath, 'ui-spec.json');
  state.hasUiDocs = fs.existsSync(uiTokensPath) || fs.existsSync(uiAssetsPath) || fs.existsSync(uiSpecPath);
  
  // Any design document
  if (fs.existsSync(designPath)) {
    const designFiles = fs.readdirSync(designPath).filter(f => 
      f.endsWith('.md') || f.endsWith('.json')
    );
    state.hasDesignDoc = designFiles.length > 0;
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Check codebase indexing (via memory/vector DB)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (deps?.memory) {
    try {
      // Try to query vector DB for codebase content
      const results = await deps.memory.query('', context.project, { k: 1 });
      state.hasCodebase = results && results.length > 0;
      if (state.hasCodebase) {
        // Get approximate indexed file count
        const allResults = await deps.memory.query('', context.project, { k: 100 });
        state.indexedFileCount = allResults?.length || 0;
      }
    } catch (error) {
      // Vector DB not available or not indexed
      state.hasCodebase = false;
    }
  }
  
  return state;
}

/**
 * Create empty workspace state (fallback)
 */
function createEmptyWorkspaceState(): WorkspaceState {
  return {
    hasPrd: false,
    hasDirective: false,
    hasScreens: false,
    hasComponents: false,
    hasAssets: false,
    hasSystemDesignDoc: false,
    hasUiDocs: false,
    hasDesignDoc: false,
    hasCodebase: false
  };
}

/**
 * Format workspace state for prompt injection
 */
export function formatWorkspaceState(state: WorkspaceState): string {
  const lines: string[] = [];
  
  lines.push('### Inputs');
  lines.push(state.hasPrd 
    ? `✅ PRD: ${state.prdPath || 'available'}` 
    : '❌ No PRD');
  lines.push(state.hasDirective 
    ? `✅ Directive: ${state.directivePath || 'available'}` 
    : 'ℹ️ No directive');
  
  lines.push('');
  lines.push('### References (ui-design)');
  lines.push(state.hasScreens 
    ? `✅ Screens: ${state.screenCount || 'multiple'} files` 
    : '❌ No screen captures');
  lines.push(state.hasComponents 
    ? `✅ Components: ${state.componentCount || 'multiple'} files` 
    : 'ℹ️ No component snapshots');
  lines.push(state.hasAssets 
    ? `✅ Assets: ${state.assetCount || 'multiple'} files` 
    : 'ℹ️ No asset files');
  
  lines.push('');
  lines.push('### Design Documents');
  lines.push(state.hasUiDocs 
    ? '✅ UI docs (ui-tokens.json, ui-assets.json, ui-spec.json)' 
    : '❌ No UI docs');
  lines.push(state.hasSystemDesignDoc 
    ? '✅ System design (system-design.md)' 
    : '❌ No system design');
  
  lines.push('');
  lines.push('### Codebase');
  lines.push(state.hasCodebase 
    ? `✅ Indexed (${state.indexedFileCount || 'unknown'} files)` 
    : '❌ Not indexed');
  lines.push(state.hasDesignDoc 
    ? '✅ Has design documents' 
    : '❌ No design documents');
  
  return lines.join('\n');
}
