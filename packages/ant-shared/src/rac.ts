/**
 * ResolvedActionContext (RAC) — Intent-Centric Prompt System
 *
 * Single source of truth for user intent, tech stack, and action context.
 * Created in resolve/detect nodes, consumed by ModeController and prompt templates.
 */

import type { Basis, ActionMetadata, UIDesignModeId } from './actions';
import { deriveFromIntent, INTENT_DEFINITIONS } from './actions';
import type { JobMode, DesignWorkType, DesignDomain, DetectionReport, JobEnvironment } from './detection';

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
}

// ============================================
// ResolvedActionContext
// ============================================

export interface ResolvedActionContext {
  intent?: string;
  workType?: DesignWorkType;
  jobMode: JobMode;

  tech: TechContext;

  target?: string[];
  basis?: Basis;
  refs?: string[];
  context?: string[];

  documents?: ResolvedDocument[];

  domain?: DesignDomain;

  intentDescription?: string;
  basisDescription?: string;

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

export function getIntentDescription(intent: string): string | undefined {
  const def = INTENT_DEFINITIONS.find(d => d.id === intent);
  return def?.description.en;
}

const BASIS_DESCRIPTIONS: Record<Basis, string> = {
  'prd': 'PRD and product requirements',
  'directive': 'User directive and instructions',
  'existing-doc': 'Existing design documents',
  'figma': 'Figma design file',
  'references': 'Reference images and screenshots',
  'spec': 'Feature specification document',
  'design-doc': 'System design document',
};

export function getBasisDescription(basis: Basis): string {
  return BASIS_DESCRIPTIONS[basis] ?? basis;
}

/**
 * Map intent to UI design source type.
 * Returns null for intents that need runtime resolution (e.g. revise-ui checks figmaConfig).
 */
export function getUiSourceFromIntent(intent: string): UIDesignModeId | null {
  switch (intent) {
    case 'create-figma': return 'figma';
    case 'create-ref': return 'references';
    case 'create-desc': return 'description';
    case 'revise-ui': return null;
    default: return null;
  }
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
  const basisDescription = actionMetadata.basis
    ? getBasisDescription(actionMetadata.basis)
    : undefined;

  const hasExplicitFields = !!(
    intentDescription ||
    basisDescription ||
    (actionMetadata.target && actionMetadata.target.length > 0) ||
    (actionMetadata.refs && actionMetadata.refs.length > 0) ||
    (actionMetadata.context && actionMetadata.context.length > 0)
  );

  return {
    intent,
    workType: derived.workType,
    jobMode: derived.jobMode,
    tech,
    target: actionMetadata.target,
    basis: actionMetadata.basis,
    refs: actionMetadata.refs,
    context: actionMetadata.context,
    intentDescription,
    basisDescription,
    source: 'explicit',
    hasExplicitFields,
  };
}

/**
 * Create RAC from LLM DetectionReport (infer path, no explicit intent).
 * Merges actionMetadata fields (basis/refs/target/context) if present.
 * Called in detect node after LLM analysis.
 */
export function resolveFromDetection(
  report: DetectionReport,
  actionMetadata?: ActionMetadata,
  codebaseProfile?: CodebaseProfileLike,
  fallbackHints?: EnvironmentHints,
): ResolvedActionContext {
  const env = mapJobEnvironmentToEnvironment(report.environment);
  const tech = buildTechContext(
    codebaseProfile || report.profile,
    env,
    undefined,
    fallbackHints,
  );

  const basisDescription = actionMetadata?.basis
    ? getBasisDescription(actionMetadata.basis)
    : undefined;

  const hasExplicitFields = !!(
    basisDescription ||
    (actionMetadata?.target && actionMetadata.target.length > 0) ||
    (actionMetadata?.refs && actionMetadata.refs.length > 0) ||
    (actionMetadata?.context && actionMetadata.context.length > 0)
  );

  return {
    workType: report.workType,
    jobMode: report.jobMode,
    tech,
    target: actionMetadata?.target,
    basis: actionMetadata?.basis,
    refs: actionMetadata?.refs,
    context: actionMetadata?.context,
    domain: report.domain,
    basisDescription,
    source: 'infer',
    hasExplicitFields,
  };
}
