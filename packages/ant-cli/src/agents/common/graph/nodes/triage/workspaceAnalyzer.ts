/**
 * Workspace Analyzer
 *
 * 워크스페이스 상태를 분석하여 WorkspaceState 객체 생성.
 * Triage 노드에서 Prerequisites 체크에 사용.
 *
 * Canonical layout (Phase B):
 *   - plan/                              (sources — prd.md, gdd.md, tech-spec.md, …)
 *   - meta/directives/{design,code,…}/   (chat-bound or hand-authored directives)
 *   - meta/evals/{prd,ui-design,…}/      (evaluation reports)
 *   - architecture/system/               (system design docs)
 *   - architecture/spec/                 (spec docs)
 *   - visual/ui/{ant,figma,handoff}/     (UI design surface)
 *   - visual/game-art/{ant,figma,handoff}/ (game-art design surface)
 *   - assets/                            (asset pool)
 */

import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceState } from './types';
import {
  ARTIFACT_PREFIX,
  FIGMA_CONFIG_PATH,
  isFigmaDataPopulated,
  migrateFigmaConfig,
} from '@ant/shared';
import { MemoryPort } from '../../../../../core/ports';
import { isTemplateContent } from '../../../../../core/utils/templateDetector';

const PLAN_DIR = ARTIFACT_PREFIX.SOURCES;
const META_DIRECTIVES_DIR = 'meta/directives';
const META_EVALS_DIR = 'meta/evals';
const ASSETS_DIR = 'assets';
const CODEBASE_DIR = 'codebase';
const ARCHITECTURE_SYSTEM_DIR = ARTIFACT_PREFIX.SYSTEM_DESIGN.replace(/\/$/, '');
const ARCHITECTURE_SPEC_DIR = ARTIFACT_PREFIX.SPEC.replace(/\/$/, '');
const VISUAL_UI_ANT_DIR = ARTIFACT_PREFIX.UI_ANT.replace(/\/$/, '');
const VISUAL_GAME_ART_ANT_DIR = ARTIFACT_PREFIX.GAME_ART_ANT.replace(/\/$/, '');

/**
 * Recognised entry-point names for codebase orientation. Path-only —
 * the analyzer never reads file body (35-codebase-meta-policy /
 * state.artifacts Post-RAC SSOT compatibility). The codebase-channel
 * partial surfaces these to the LLM so existing-project work has cheap
 * structural cues without inflating prompt tokens.
 */
const CODEBASE_ENTRY_POINT_NAMES: readonly string[] = [
  'package.json', 'tsconfig.json', 'pyproject.toml', 'Cargo.toml',
  'go.mod', 'pom.xml', 'build.gradle', 'composer.json', 'Gemfile',
  'README.md', 'README.MD', 'README',
  'src', 'app', 'lib', 'pages', 'components', 'public', 'tests', 'test',
];

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

  const state: WorkspaceState = {
    featurePath,
    hasPlan: false,
    hasMetaDirectives: false,
    hasAssets: false,
    hasFigmaConfig: false,
    hasArchitectureSystem: false,
    hasVisualUi: false,
    hasVisualGameArt: false,
    hasMetaEvals: false,
    hasArchitectureSpec: false,
    hasDesignDoc: false,
    hasCodebase: false,
  };

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // plan/ — text-bearing source files (prd.md, gdd.md, tech-spec.md, …)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const planAbs = path.join(featurePath, PLAN_DIR);
  const textExtensions = ['.md', '.txt', '.json', '.yaml', '.yml', '.csv', '.xml', '.html'];
  const validPlanFiles: string[] = [];

  if (fs.existsSync(planAbs)) {
    const entries = fs.readdirSync(planAbs, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!textExtensions.includes(ext)) continue;
      const filePath = path.join(planAbs, entry.name);
      const content = fs.readFileSync(filePath, 'utf-8');
      if (content.trim().length > 0 && !isTemplateContent(content)) {
        validPlanFiles.push(entry.name);
      }
    }
  }

  state.planFileCount = validPlanFiles.length;
  state.planFileNames = validPlanFiles.length > 0 ? validPlanFiles : undefined;
  state.hasPlan = validPlanFiles.length > 0;

  if (state.hasPlan) {
    // Plan-job canonical outputs are domain-aware: service → prd.md,
    // game → gdd.md. The analyzer does not know the workspace domain
    // here, so prefer prd.md, then gdd.md, then fall back to the first
    // source file. Either canonical filename is treated as "the plan
    // document"; downstream resolvers use `pickExistingPlanFilename`
    // when domain context is available.
    const canonical = validPlanFiles.includes('prd.md')
      ? 'prd.md'
      : validPlanFiles.includes('gdd.md')
        ? 'gdd.md'
        : validPlanFiles[0];
    state.planPath = path.join(planAbs, canonical);
  }
  console.log(`📄 [WorkspaceAnalyzer] Plan files: ${validPlanFiles.length} found (${validPlanFiles.join(', ') || 'none'}) → hasPlan=${state.hasPlan}`);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // meta/directives/{design,code}/directive.md
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const designDirectivePath = path.join(featurePath, META_DIRECTIVES_DIR, 'design', 'directive.md');
  const codeDirectivePath = path.join(featurePath, META_DIRECTIVES_DIR, 'code', 'directive.md');

  for (const directivePath of [designDirectivePath, codeDirectivePath]) {
    if (fs.existsSync(directivePath)) {
      const content = fs.readFileSync(directivePath, 'utf-8');
      if (!isTemplateContent(content) && content.trim().length > 0) {
        state.hasMetaDirectives = true;
        state.directivePath = directivePath;
        break;
      }
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // visual/ui/figma/figma.json — Figma workfile reference.
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
  // assets/
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const assetsPath = path.join(featurePath, ASSETS_DIR);
  state.hasAssets = hasFilesInDir(assetsPath);
  if (state.hasAssets) {
    state.assetCount = countFilesInDir(assetsPath, true);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // architecture/system/  — fe-system-*.md / be-system-*.md / api-contract-*.md
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const architectureSystemAbs = path.join(featurePath, ARCHITECTURE_SYSTEM_DIR);
  {
    const systemFiles = fs.existsSync(architectureSystemAbs)
      ? fs.readdirSync(architectureSystemAbs)
      : [];
    const matchedSystemDocs = systemFiles.filter(f =>
      (f.startsWith('fe-system-') || f.startsWith('be-system-') || f.startsWith('api-contract-')) && f.endsWith('.md')
    );
    state.hasArchitectureSystem = matchedSystemDocs.length > 0;
    if (matchedSystemDocs.length > 0) {
      state.systemDesignFileNames = matchedSystemDocs;
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // architecture/spec/ — spec-*.md
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const architectureSpecAbs = path.join(featurePath, ARCHITECTURE_SPEC_DIR);
  {
    const specFiles = fs.existsSync(architectureSpecAbs)
      ? fs.readdirSync(architectureSpecAbs).filter(f => f.startsWith('spec-') && f.endsWith('.md'))
      : [];
    state.hasArchitectureSpec = specFiles.length > 0;
    if (state.hasArchitectureSpec) {
      state.specDocCount = specFiles.length;
      state.specDocNames = specFiles;
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // visual/ui/ant/ — canonical UI design surface
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const uiAntAbs = path.join(featurePath, VISUAL_UI_ANT_DIR);
  const existsInUiAnt = (name: string) => fs.existsSync(path.join(uiAntAbs, name));
  state.hasVisualUi =
    existsInUiAnt('ui-tokens.json') ||
    existsInUiAnt('ui-assets.json') ||
    existsInUiAnt('ui-spec.json');

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // visual/game-art/ant/ — canonical game-art design surface
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const gameArtAntAbs = path.join(featurePath, VISUAL_GAME_ART_ANT_DIR);
  const existsInGameArtAnt = (name: string) => fs.existsSync(path.join(gameArtAntAbs, name));
  state.hasVisualGameArt =
    existsInGameArtAnt('game-art-tokens.json') ||
    existsInGameArtAnt('game-art-assets.json') ||
    existsInGameArtAnt('game-art-spec.json');

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Aggregate `hasDesignDoc` — any architecture/visual artifact present.
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  state.hasDesignDoc =
    state.hasArchitectureSystem ||
    state.hasArchitectureSpec ||
    state.hasVisualUi ||
    state.hasVisualGameArt;

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // meta/evals/ — evaluation reports
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const evalsPath = path.join(featurePath, META_EVALS_DIR);
  if (fs.existsSync(evalsPath)) {
    const evalFileCount = countFilesInDir(evalsPath, true);
    state.hasMetaEvals = evalFileCount > 0;
    if (state.hasMetaEvals) {
      state.evalCount = evalFileCount;
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // codebase — disk walk (depth-1, path-only) OR memory / vector index
  // (Codebase Channel SSOT). Either signal flips hasCodebase=true so
  // existing-project workspaces always activate the codebase-channel
  // partial in plan/design jobs even before gen-learn runs.
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const codebaseAbs = path.join(featurePath, CODEBASE_DIR);
  const entryPoints = scanCodebaseEntryPoints(codebaseAbs);
  if (entryPoints.length > 0) {
    state.hasCodebase = true;
    state.codebaseEntryPoints = entryPoints;
  }

  if (deps?.memory) {
    try {
      const results = await deps.memory.query('', deps.projectId || '', { k: 1 });
      const indexed = results && results.length > 0;
      if (indexed) {
        state.hasCodebase = true;
        const allResults = await deps.memory.query('', deps.projectId || '', { k: 100 });
        state.indexedFileCount = allResults?.length || 0;
      }
    } catch {
      // Memory probe failure leaves disk-derived hasCodebase intact.
    }
  }

  return state;
}

/**
 * Path-only entry-point scan under `codebase/`. Returns the subset of
 * `CODEBASE_ENTRY_POINT_NAMES` that actually exists at depth 1. No file
 * bodies are read. Returns [] when the directory is missing or empty.
 */
function scanCodebaseEntryPoints(codebaseAbs: string): string[] {
  if (!fs.existsSync(codebaseAbs)) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(codebaseAbs, { withFileTypes: true });
  } catch {
    return [];
  }
  if (entries.length === 0) return [];
  const present = new Set(
    entries.filter(e => !e.name.startsWith('.')).map(e => e.name),
  );
  const matched = CODEBASE_ENTRY_POINT_NAMES.filter(n => present.has(n));
  // Even with zero canonical entry points, a non-empty codebase/ tree is
  // still an "existing project" signal — fall back to a single sentinel
  // so `hasCodebase` flips and the partial activates.
  if (matched.length === 0 && present.size > 0) return ['codebase/'];
  return matched;
}

/**
 * Create empty workspace state (fallback)
 */
function createEmptyWorkspaceState(): WorkspaceState {
  return {
    hasPlan: false,
    hasMetaDirectives: false,
    hasAssets: false,
    hasFigmaConfig: false,
    hasArchitectureSystem: false,
    hasVisualUi: false,
    hasVisualGameArt: false,
    hasMetaEvals: false,
    hasArchitectureSpec: false,
    hasDesignDoc: false,
    hasCodebase: false,
  };
}

/**
 * Format workspace state for prompt injection
 */
export function formatWorkspaceState(state: WorkspaceState): string {
  const lines: string[] = [];

  lines.push('### Plan');
  lines.push(state.hasPlan
    ? `✅ Plan: ${state.planPath || 'available'}`
    : '❌ No plan');
  lines.push(state.hasMetaDirectives
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
  lines.push(state.hasVisualUi
    ? '✅ UI docs (ui-tokens.json, ui-assets.json, ui-spec.json)'
    : '❌ No UI docs');
  lines.push(state.hasVisualGameArt
    ? '✅ Game-art docs (game-art-tokens.json, game-art-assets.json, game-art-spec.json)'
    : 'ℹ️ No game-art docs');
  lines.push(state.hasArchitectureSystem
    ? '✅ System design docs found'
    : '❌ No system design');

  lines.push('');
  lines.push('### Evaluations');
  lines.push(state.hasMetaEvals
    ? `✅ Eval reports: ${state.evalCount || 'available'} files (meta/evals/)`
    : 'ℹ️ No evaluation reports');

  lines.push('');
  lines.push('### Spec Documents');
  lines.push(state.hasArchitectureSpec
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
