/**
 * ResolvedActionContext (RAC) — Intent-Centric Prompt System
 *
 * Single source of truth for user intent, tech stack, and action context.
 * Created in resolve/detect nodes, consumed by ModeController and prompt templates.
 */

import type { ActionMetadata, IntentId } from './actions';
import { deriveFromIntent, INTENT_DEFINITIONS } from './actions';
import type { Mode, IntentGroup, DesignDomain, DetectionReport, JobEnvironment } from './detection';

// ============================================
// Workspace State (minimal, for infer path)
// ============================================

export interface InferWorkspaceState {
  hasFigmaConfig?: boolean;
  hasScreens?: boolean;
  hasComponents?: boolean;
  hasPrd?: boolean;
  hasDesignDoc?: boolean;
  hasSpecDocs?: boolean;
  targetFiles?: string[];
}

// ============================================
// TechContext Types
// ============================================

export type Language = 'typescript' | 'go' | 'python' | 'rust' | 'java';
export type Environment = 'frontend' | 'backend' | 'fullstack';
export type RuntimePlatform = 'browser' | 'node-api' | 'go-api';

export interface TechContext {
  language?: Language;
  framework?: string;
  environment?: Environment;
  runtime?: RuntimePlatform;
}

// ============================================
// ResolvedDocument (role-labeled file content for action-context rendering)
// ============================================

export interface ResolvedDocument {
  path: string;
  content: string;
  role: 'ref' | 'context';
  label?: string;
}

// ============================================
// ResolvedActionContext
// ============================================

export interface ResolvedActionContext {
  intent?: IntentId;
  intentGroup?: IntentGroup;
  mode: Mode;

  tech: TechContext;

  target?: string[];
  refs?: string[];
  context?: string[];

  documents?: ResolvedDocument[];

  domain?: DesignDomain;

  intentDescription?: string;

  source: 'explicit' | 'infer';
  hasExplicitFields: boolean;
}

// ============================================
// Profile interfaces (minimal, for parameter typing)
// ============================================

export interface CodebaseProfileLike {
  language?: string;
  framework?: string;
}

export interface TaskProfileLike {
  language?: string;
  framework?: string;
}

export interface EnvironmentHints {
  designDocPath?: string;
  hasNextConfig?: boolean;
  hasBrowserEntrypoint?: boolean;
}

// ============================================
// TechContext Helpers
// ============================================

/**
 * Normalize codebaseProfile language to canonical Language type.
 * Mirrors ModeController.detectLanguage() logic.
 */
export function resolveLanguage(profile?: CodebaseProfileLike): Language {
  const raw = profile?.language?.toLowerCase();
  if (!raw) return 'typescript';
  if (raw.includes('typescript') || raw.includes('javascript')) return 'typescript';
  if (raw.includes('go') || raw.includes('golang')) return 'go';
  if (raw.includes('python')) return 'python';
  if (raw.includes('rust')) return 'rust';
  if (raw.includes('java')) return 'java';
  return 'typescript';
}

/**
 * Normalize framework string. taskProfile takes priority over codebaseProfile.
 * Mirrors ModeController.detectFrameworkAugmentation() normalization.
 */
export function resolveFramework(
  profile?: CodebaseProfileLike,
  taskProfile?: TaskProfileLike,
): string | undefined {
  const fw = (taskProfile?.framework || profile?.framework)?.toLowerCase();
  if (!fw) return undefined;
  if (fw.includes('next') || fw.includes('nextjs')) return 'nextjs';
  if (fw.includes('nuxt')) return 'nuxt';
  if (fw.includes('express')) return 'express';
  return fw;
}

/**
 * Derive concrete RuntimePlatform from abstract Environment + Language.
 * frontend → browser, backend + go → go-api, backend + * → node-api, fullstack → undefined (composite).
 */
export function resolveRuntime(
  env?: Environment | string,
  language?: Language | string,
): RuntimePlatform | undefined {
  if (!env) return undefined;
  switch (env) {
    case 'frontend': return 'browser';
    case 'backend': return language === 'go' ? 'go-api' : 'node-api';
    case 'fullstack': return undefined;
    default: return undefined;
  }
}

/**
 * Fallback environment inference from file naming conventions and framework files.
 * Mirrors ModeController.detectEnvironment() fallback chain (after LLM pre-detection).
 */
export function inferEnvironmentFromHints(
  hints?: EnvironmentHints,
  _language?: Language,
): Environment | undefined {
  if (!hints) return undefined;

  const path = hints.designDocPath?.toLowerCase();
  if (path) {
    if (path.includes('fe-system-') || path.includes('frontend-design') || path.includes('fe-design')) {
      return 'frontend';
    }
    if (path.includes('be-system-') || path.includes('backend-design') || path.includes('be-design') || path.includes('api-design')) {
      return 'backend';
    }
    if (path.includes('fullstack-design') || path.includes('fs-design')) {
      return 'fullstack';
    }
  }

  if (hints.hasNextConfig || hints.hasBrowserEntrypoint) {
    return 'frontend';
  }

  return undefined;
}

/**
 * Build a complete TechContext in one call.
 * env param takes priority; falls back to inferEnvironmentFromHints when env is undefined.
 */
export function buildTechContext(
  profile?: CodebaseProfileLike,
  env?: Environment,
  taskProfile?: TaskProfileLike,
  fallbackHints?: EnvironmentHints,
): TechContext {
  const language = resolveLanguage(profile || taskProfile);
  const resolvedEnv = env || inferEnvironmentFromHints(fallbackHints, language);
  return {
    language,
    framework: resolveFramework(profile, taskProfile),
    environment: resolvedEnv,
    runtime: resolveRuntime(resolvedEnv, language),
  };
}

// ============================================
// Description Helpers
// ============================================

export function getIntentDescription(intent: IntentId): string | undefined {
  const def = INTENT_DEFINITIONS.find(d => d.id === intent);
  return def?.description.en;
}

// ============================================
// RAC Creation Functions
// ============================================

function mapJobEnvironmentToEnvironment(env?: JobEnvironment): Environment | undefined {
  if (!env || env === 'unknown') return undefined;
  return env as Environment;
}

/**
 * Create RAC from explicit ActionMetadata (user selected intent via ActionsPanel).
 * Called in resolve node when actionMetadata.intent is present.
 */
export function resolveFromExplicit(
  actionMetadata: ActionMetadata,
  codebaseProfile?: CodebaseProfileLike,
  fallbackHints?: EnvironmentHints,
): ResolvedActionContext {
  const intent = actionMetadata.intent!;
  const derived = deriveFromIntent(intent);

  const env = derived.environment as Environment | undefined;
  const tech = buildTechContext(codebaseProfile, env, undefined, fallbackHints);

  const intentDescription = getIntentDescription(intent);

  const hasExplicitFields = !!(
    intentDescription ||
    (actionMetadata.target && actionMetadata.target.length > 0) ||
    (actionMetadata.refs && actionMetadata.refs.length > 0) ||
    (actionMetadata.context && actionMetadata.context.length > 0)
  );

  return {
    intent,
    intentGroup: derived.intentGroup,
    mode: derived.mode,
    tech,
    target: actionMetadata.target,
    refs: actionMetadata.refs,
    context: actionMetadata.context,
    intentDescription,
    source: 'explicit',
    hasExplicitFields,
  };
}

/**
 * Create RAC from LLM DetectionReport (infer path).
 * Merges actionMetadata fields with inferred values:
 *  - intent/targets: metadata replaces inferred (if present)
 *  - refs/context: additive (dedup merge of inferred + metadata)
 *
 * @param report - Optional: DetectionReport from LLM analysis. When undefined
 *   (e.g. plan/learn jobs), mode/env are derived from synthesizedIntent.
 * @param synthesizedIntent - Optional intent ID synthesized from DetectionReport
 *   or determined by job-specific logic. When provided, the returned RAC
 *   carries intent + intentDescription.
 */
export function resolveFromInfer(
  report: DetectionReport | undefined,
  actionMetadata?: ActionMetadata,
  codebaseProfile?: CodebaseProfileLike,
  fallbackHints?: EnvironmentHints,
  synthesizedIntent?: IntentId,
  _workspaceState?: InferWorkspaceState,
): ResolvedActionContext {
  const derivedFromIntent = synthesizedIntent ? deriveFromIntent(synthesizedIntent) : undefined;

  const env = report
    ? mapJobEnvironmentToEnvironment(report.environment)
    : (derivedFromIntent?.environment as Environment | undefined);
  const tech = buildTechContext(
    codebaseProfile || report?.profile,
    env,
    undefined,
    fallbackHints,
  );

  const mode: Mode = report?.detectedMode
    ?? derivedFromIntent?.mode
    ?? 'generate';

  // targets: metadata replaces inferred (if present)
  const target = (actionMetadata?.target?.length)
    ? actionMetadata.target
    : (report?.targetFiles?.length ? report.targetFiles : undefined);

  // refs: metadata only (primarySources removed from DetectionReport)
  const metadataRefs = actionMetadata?.refs ?? [];
  const refs = metadataRefs.length > 0 ? metadataRefs : undefined;

  // context: metadata only (DetectionReport has no contextFiles field)
  const metadataCtx = actionMetadata?.context ?? [];
  const mergedCtx = dedup([...metadataCtx]);
  const context = mergedCtx.length > 0 ? mergedCtx : undefined;

  const hasExplicitFields = !!(
    (actionMetadata?.target && actionMetadata.target.length > 0) ||
    (actionMetadata?.refs && actionMetadata.refs.length > 0) ||
    (actionMetadata?.context && actionMetadata.context.length > 0)
  );

  return {
    intent: synthesizedIntent,
    intentDescription: synthesizedIntent
      ? getIntentDescription(synthesizedIntent)
      : undefined,
    intentGroup: report?.detectedIntentGroup ?? derivedFromIntent?.intentGroup,
    mode,
    tech,
    target,
    refs,
    context,
    domain: report?.domain,
    source: 'infer',
    hasExplicitFields,
  };
}

/** Deduplicate string array, preserving order of first occurrence. */
function dedup(arr: string[]): string[] {
  return [...new Set(arr)];
}

// ============================================
// Intent-based Pipeline Helpers
// ============================================

/**
 * Determine whether the Figma MCP pipeline should be used.
 *
 * Returns true when the intent is gen-ui-figma or rev-ui with populated figmaConfig.
 */
export function isFigmaPipeline(
  intent: IntentId | undefined,
  figmaPopulated: boolean,
): boolean {
  if (intent === 'gen-ui-figma') return true;
  if (intent === 'rev-ui' && figmaPopulated) return true;
  return false;
}

// ============================================
// Intent Synthesis (reverse of deriveFromIntent)
// ============================================

/**
 * Synthesize an intent ID for design jobs from a DetectionReport + environment hints.
 * Inverse of deriveFromIntent(): given observed detection results, pick the
 * closest matching intent ID from INTENT_DEFINITIONS.
 *
 * Called in design detectEnvironment after LLM analysis, passed to resolveFromInfer().
 */
export function synthesizeDesignIntent(
  report: DetectionReport,
  hints: { figmaPopulated?: boolean; hasReferences?: boolean },
): IntentId {
  const intentGroup = report.detectedIntentGroup;
  const { detectedMode } = report;

  if (detectedMode === 'explain') {
    if (intentGroup === 'design-ui') return 'explain-ui';
    if (intentGroup === 'design-spec') return 'explain-spec';
    return 'explain-sys';
  }

  if (intentGroup === 'design-ui') {
    if (detectedMode === 'refactor') return 'rev-ui';
    if (hints.figmaPopulated) return 'gen-ui-figma';
    if (hints.hasReferences) return 'gen-ui-ref';
    return 'gen-ui-desc';
  }
  if (intentGroup === 'design-spec') {
    return detectedMode === 'refactor' ? 'rev-spec' : 'gen-spec';
  }
  // design-system (default)
  if (detectedMode === 'refactor') return 'rev-sys';
  const env = report.environment;
  if (env === 'frontend') return 'gen-sys-fe';
  if (env === 'backend') return 'gen-sys-be';
  return 'gen-sys-full';
}

/**
 * Synthesize an intent ID for code jobs from a DetectionReport.
 * Called in code detectEnvironment after LLM analysis, passed to resolveFromInfer().
 */
export function synthesizeCodeIntent(
  report: DetectionReport,
  workspaceState?: InferWorkspaceState,
): IntentId {
  if (report.detectedMode === 'explain') return 'explain-code';
  if (report.detectedMode === 'refactor') return 'rev-code';
  if (workspaceState?.hasDesignDoc) return 'gen-code-sys';
  if (workspaceState?.hasSpecDocs) return 'gen-code-spec';
  return 'gen-code-directive';
}

/**
 * Synthesize an intent ID for plan jobs from the detected mode.
 * Called in planner resolve node after DetectionReport creation.
 */
export function synthesizePlanIntent(
  mode: string,
): IntentId {
  if (mode === 'explain') return 'explain-plan';
  // 'refine' accepted for backward compat with legacy session data
  return (mode === 'refactor' || mode === 'refine') ? 'rev-plan' : 'gen-plan';
}

/**
 * Synthesize an intent ID for visual jobs from the classified jobMode + targetTier.
 * Maps targetTier to gen-visual-{tier}; explain always returns 'explain-visual'.
 * Called in visual classify node after LLM classification.
 */
export function synthesizeVisualIntent(
  jobMode: string,
  targetTier?: string,
): IntentId {
  if (jobMode === 'explain') return 'explain-visual';
  const tier = (!targetTier || targetTier === 'general') ? 'illustration' : targetTier;
  return `gen-visual-${tier}` as IntentId;
}

/**
 * Synthesize an intent ID for ask jobs from the triage sub-type.
 * Ask has three intents mapped 1:1 from askSubType.
 * Called in triage node when intent is 'ask'.
 */
export function synthesizeAskIntent(
  subType?: 'evaluate' | 'ant' | 'general',
): IntentId {
  switch (subType) {
    case 'evaluate': return 'ask-evaluate';
    case 'ant': return 'ask-ant';
    default: return 'ask-general';
  }
}

/**
 * Synthesize an intent ID for learn jobs.
 * Learn has a single generative intent ('gen-learn'); no explain/refactor modes.
 * Called in learn decompose node before LLM classification.
 */
export function synthesizeLearnIntent(): IntentId {
  return 'gen-learn';
}
