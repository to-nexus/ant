/**
 * Workspace Analyzer
 * 
 * 워크스페이스 상태를 분석하여 WorkspaceState 객체 생성
 * Triage 노드에서 Prerequisites 체크에 사용
 */

import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceState } from './types';
import { DESIGN_DIR, DESIGN_SUBDIRS } from '@ant/shared';
import { MemoryPort } from '../../../../../core/ports';
import { isTemplateContent } from '../../../../../core/utils/templateDetector';
import { migrateFigmaConfig, isFigmaDataPopulated, FIGMA_CONFIG_PATH } from '@ant/shared';

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
    hasAssets: false,
    hasFigmaConfig: false,
    hasSystemDesignDoc: false,
    hasUiDocs: false,
    hasEvals: false,
    hasSpecDocs: false,
    hasDesignDoc: false,
    hasCodebase: false,
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
    // Plan-job canonical outputs are domain-aware: service → prd.md,
    // game → gdd.md. The analyzer does not know the workspace domain
    // here, so prefer prd.md, then gdd.md, then fall back to the first
    // source file. Either canonical filename is treated as "the plan
    // document"; downstream resolvers use `pickExistingPlanFilename`
    // when domain context is available.
    const canonical = validSourceFiles.includes('prd.md')
      ? 'prd.md'
      : validSourceFiles.includes('gdd.md')
        ? 'gdd.md'
        : validSourceFiles[0];
    state.prdPath = path.join(sourcesDir, canonical);
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
  // Check Figma workfile reference (outputs/design/ui/figma/figma.json).
  // `hasFigmaConfig` reflects workfile presence only — MCP reachability is
  // NOT checked here (that lives in code resolve's `detectFigmaSource`).
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const figmaJsonPath = path.join(featurePath, FIGMA_CONFIG_PATH);
  if (fs.existsSync(figmaJsonPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(figmaJsonPath, 'utf-8'));
      const figmaConfig = migrateFigmaConfig(raw);
      state.hasFigmaConfig = isFigmaDataPopulated(figmaConfig);
    } catch {
      // Invalid JSON — treat as no config
    }
  }
  console.log(`🎨 [WorkspaceAnalyzer] Figma workfile: ${state.hasFigmaConfig ? 'configured' : 'none'}`);

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
  const designPath = path.join(featurePath, DESIGN_DIR);
  
  const listDesignSubdir = (subdir: string) => {
    const dir = path.join(designPath, subdir);
    if (!fs.existsSync(dir)) return [] as string[];
    return fs.readdirSync(dir);
  };

  // System design — canonical outputs/design/system/ only
  {
    const systemFiles = listDesignSubdir('system');
    const matchedSystemDocs = systemFiles.filter(f =>
      (f.startsWith('fe-system-') || f.startsWith('be-system-') || f.startsWith('api-contract-')) && f.endsWith('.md')
    );
    state.hasSystemDesignDoc = matchedSystemDocs.length > 0;
    if (matchedSystemDocs.length > 0) {
      state.systemDesignFileNames = matchedSystemDocs;
    }
  }

  // UI docs — canonical outputs/design/ui/ant/ only (SSOT for ant UiSource)
  const uiAntDir = path.join(designPath, 'ui', 'ant');
  const existsInUiAnt = (name: string) => fs.existsSync(path.join(uiAntDir, name));
  state.hasUiDocs = existsInUiAnt('ui-tokens.json') || existsInUiAnt('ui-assets.json') || existsInUiAnt('ui-spec.json');

  // Spec documents — canonical outputs/design/spec/ only
  {
    const specFiles = listDesignSubdir('spec').filter(f =>
      f.startsWith('spec-') && f.endsWith('.md')
    );
    state.hasSpecDocs = specFiles.length > 0;
    if (state.hasSpecDocs) {
      state.specDocCount = specFiles.length;
      state.specDocNames = specFiles;
    }
  }

  // Any design document (across canonical subdirectories)
  {
    const allDesignFiles = [
      ...listDesignSubdir('system'),
      ...listDesignSubdir('ui/ant'),
      ...listDesignSubdir('spec'),
    ].filter(f => f.endsWith('.md') || f.endsWith('.json'));
    state.hasDesignDoc = allDesignFiles.length > 0;
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
    hasAssets: false,
    hasFigmaConfig: false,
    hasSystemDesignDoc: false,
    hasUiDocs: false,
    hasEvals: false,
    hasSpecDocs: false,
    hasDesignDoc: false,
    hasCodebase: false,
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
  lines.push('### Visual Sources (ui-design)');
  lines.push(state.hasFigmaConfig
    ? '✅ Figma: file configured'
    : 'ℹ️ No Figma config');
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
