/**
 * Workspace Analyzer
 * 
 * 워크스페이스 상태를 분석하여 WorkspaceState 객체 생성
 * Triage 노드에서 Prerequisites 체크에 사용
 */

import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceState } from './types';
import { MemoryPort } from '../../../../core/ports';
import { isTemplateContent } from '../../../../core/utils/templateDetector';
import { migrateFigmaConfig, isFigmaDataPopulated } from '@ant/shared';

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
 * Analyze workspace and return WorkspaceState.
 * 
 * @param featurePath - Absolute path to the feature directory (required).
 *                      This is the single source of truth for workspace location.
 * @param deps        - Optional dependencies for extended checks (e.g., memory/vector DB).
 */
export async function analyzeWorkspace(
  featurePath: string,
  deps?: {
    memory?: MemoryPort;
    projectId?: string;
  }
): Promise<WorkspaceState> {
  console.log(`📂 [WorkspaceAnalyzer] featurePath: ${featurePath || '(not set)'}`);
  
  if (!featurePath) {
    console.warn('[WorkspaceAnalyzer] featurePath is empty — returning empty state');
    return createEmptyWorkspaceState();
  }
  
  // Initialize state
  const state: WorkspaceState = {
    featurePath,
    hasPrd: false,
    hasDirective: false,
    hasScreens: false,
    hasComponents: false,
    hasAssets: false,
    hasFigmaConfig: false,
    hasSystemDesignDoc: false,
    hasUiDocs: false,
    hasEvals: false,
    hasSpecDocs: false,
    hasDesignDoc: false,
    hasCodebase: false
  };
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Check inputs/sources (all text files, not just prd.md)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const sourcesDir = path.join(featurePath, 'inputs', 'sources');
  const textExtensions = ['.md', '.txt', '.json', '.yaml', '.yml', '.csv', '.xml', '.html'];
  const validSourceFiles: string[] = [];

  if (fs.existsSync(sourcesDir)) {
    const entries = fs.readdirSync(sourcesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!textExtensions.includes(ext)) continue;
      const filePath = path.join(sourcesDir, entry.name);
      const content = fs.readFileSync(filePath, 'utf-8');
      if (content.trim().length > 0 && !isTemplateContent(content)) {
        validSourceFiles.push(entry.name);
      }
    }
  }

  state.sourceFileCount = validSourceFiles.length;
  state.sourceFileNames = validSourceFiles.length > 0 ? validSourceFiles : undefined;
  state.hasPrd = validSourceFiles.length > 0;

  if (state.hasPrd) {
    const prdPath = path.join(sourcesDir, 'prd.md');
    state.prdPath = validSourceFiles.includes('prd.md') ? prdPath : path.join(sourcesDir, validSourceFiles[0]);
  }
  console.log(`📄 [WorkspaceAnalyzer] Source files: ${validSourceFiles.length} found (${validSourceFiles.join(', ') || 'none'}) → hasPrd=${state.hasPrd}`);
  
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
  // Check references (for ui-design) — screens and components separately
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const screensPath = path.join(featurePath, 'inputs', 'references', 'screens');
  const screensCount = countFilesInDir(screensPath, true);
  state.hasScreens = screensCount > 0;
  if (state.hasScreens) {
    state.screenCount = screensCount;
  }

  const componentsPath = path.join(featurePath, 'inputs', 'references', 'components');
  const componentsCount = countFilesInDir(componentsPath, true);
  state.hasComponents = componentsCount > 0;
  if (state.hasComponents) {
    state.componentCount = componentsCount;
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Check Figma config (inputs/figma.json with populated files)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const figmaJsonPath = path.join(featurePath, 'inputs', 'figma.json');
  if (fs.existsSync(figmaJsonPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(figmaJsonPath, 'utf-8'));
      const figmaConfig = migrateFigmaConfig(raw);
      state.hasFigmaConfig = isFigmaDataPopulated(figmaConfig);
    } catch {
      // Invalid JSON — treat as no config
    }
  }
  console.log(`🎨 [WorkspaceAnalyzer] Figma config: ${state.hasFigmaConfig ? 'configured' : 'none'}`);

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
  
  // System design - check for any design doc matching unified naming patterns
  if (fs.existsSync(designPath)) {
    const files = fs.readdirSync(designPath);
    state.hasSystemDesignDoc = files.some(f => 
      (f.startsWith('fe-system-') || f.startsWith('be-system-') || f.startsWith('api-contract-')) && f.endsWith('.md')
    );
  } else {
    state.hasSystemDesignDoc = false;
  }
  
  // UI docs (ui-tokens.json, ui-assets.json, ui-spec.json)
  const uiTokensPath = path.join(designPath, 'ui-tokens.json');
  const uiAssetsPath = path.join(designPath, 'ui-assets.json');
  const uiSpecPath = path.join(designPath, 'ui-spec.json');
  state.hasUiDocs = fs.existsSync(uiTokensPath) || fs.existsSync(uiAssetsPath) || fs.existsSync(uiSpecPath);
  
  // Spec documents (spec-*.md)
  if (fs.existsSync(designPath)) {
    const specFiles = fs.readdirSync(designPath).filter(f =>
      f.startsWith('spec-') && f.endsWith('.md')
    );
    state.hasSpecDocs = specFiles.length > 0;
    if (state.hasSpecDocs) {
      state.specDocCount = specFiles.length;
      state.specDocNames = specFiles;
    }
  } else {
    state.hasSpecDocs = false;
  }

  // Any design document
  if (fs.existsSync(designPath)) {
    const designFiles = fs.readdirSync(designPath).filter(f => 
      f.endsWith('.md') || f.endsWith('.json')
    );
    state.hasDesignDoc = designFiles.length > 0;
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Check evaluation reports
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const evalsPath = path.join(featurePath, 'outputs', 'evals');
  if (fs.existsSync(evalsPath)) {
    const evalFileCount = countFilesInDir(evalsPath, true);
    state.hasEvals = evalFileCount > 0;
    if (state.hasEvals) {
      state.evalCount = evalFileCount;
    }
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Check codebase indexing (via memory/vector DB)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (deps?.memory) {
    try {
      // Try to query vector DB for codebase content
      const results = await deps.memory.query('', deps.projectId || '', { k: 1 });
      state.hasCodebase = results && results.length > 0;
      if (state.hasCodebase) {
        // Get approximate indexed file count
        const allResults = await deps.memory.query('', deps.projectId || '', { k: 100 });
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
    hasFigmaConfig: false,
    hasSystemDesignDoc: false,
    hasUiDocs: false,
    hasEvals: false,
    hasSpecDocs: false,
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
  lines.push(state.hasFigmaConfig
    ? '✅ Figma: file configured'
    : 'ℹ️ No Figma config');
  lines.push(state.hasScreens 
    ? `✅ Screens: ${state.screenCount || 'multiple'} files` 
    : '❌ No screen references');
  lines.push(state.hasComponents 
    ? `✅ Components: ${state.componentCount || 'multiple'} files` 
    : 'ℹ️ No component references');
  lines.push(state.hasAssets 
    ? `✅ Assets: ${state.assetCount || 'multiple'} files` 
    : 'ℹ️ No asset files');
  
  lines.push('');
  lines.push('### Design Documents');
  lines.push(state.hasUiDocs 
    ? '✅ UI docs (ui-tokens.json, ui-assets.json, ui-spec.json)' 
    : '❌ No UI docs');
  lines.push(state.hasSystemDesignDoc 
    ? '✅ System design docs found' 
    : '❌ No system design');
  
  lines.push('');
  lines.push('### Evaluations');
  lines.push(state.hasEvals 
    ? `✅ Eval reports: ${state.evalCount || 'available'} files (outputs/evals/)` 
    : 'ℹ️ No evaluation reports');
  
  lines.push('');
  lines.push('### Spec Documents');
  lines.push(state.hasSpecDocs
    ? `✅ Spec docs: ${state.specDocCount} files (${state.specDocNames?.join(', ')})`
    : '❌ No spec documents');

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
