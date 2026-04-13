/**
 * ResolvedActionContext (RAC) — Intent-Centric Action Specification
 *
 * Detect node's immutable output. Describes WHAT the user wants:
 *   intent, mode, file slots (target/refs/context), domain.
 *
 * Does NOT contain tech/runtime concerns — those live in state.techTier
 * (filled by decompose, consumed by ModeController/prompt templates).
 *
 * Created via resolveToRAC() — the single unified funnel for both
 * explicit and infer paths. mode/intentGroup are always derived from
 * intentId via deriveFromIntent(), never provided as raw input.
 */

import type { ActionMetadata, IntentId } from './actions';
import { deriveFromIntent, INTENT_DEFINITIONS } from './actions';
import type { Mode, IntentGroup, DesignDomain, InferredAction } from './detection';

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
// TechTier (decompose output, NOT in RAC)
// ============================================

export type Language = 'typescript' | 'go' | 'python' | 'rust' | 'java';
export type Stack = 'frontend' | 'backend' | 'fullstack';
export type RuntimePlatform = 'browser' | 'node-api' | 'go-api';

/**
 * Technology tier — decompose's output describing HOW to execute.
 * Lives on state.techTier, not inside RAC.
 *
 * Single source of truth for all tech-stack information.
 * Replaces legacy CodebaseProfile, state.profile, and context.codebaseProfile.
 */
export interface TechTier {
  language?: Language;
  framework?: string;
  stack?: Stack;
  runtime?: RuntimePlatform;
  packageManager?: 'npm' | 'yarn' | 'pnpm' | 'bun';
}

// ============================================
// TechTier Helpers (used by decompose)
// ============================================

export interface CodebaseProfileLike {
  language?: string;
  framework?: string;
}

export interface TaskProfileLike {
  language?: string;
  framework?: string;
}

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

export function resolveRuntime(
  stack?: Stack | string,
  language?: Language | string,
): RuntimePlatform | undefined {
  if (!stack) return undefined;
  switch (stack) {
    case 'frontend': return 'browser';
    case 'backend': return language === 'go' ? 'go-api' : 'node-api';
    case 'fullstack': return undefined;
    default: return undefined;
  }
}

/**
 * Build a complete TechTier from codebase analysis results.
 * Called by decompose, NOT by detect.
 */
export function buildTechTier(
  profile?: CodebaseProfileLike,
  stack?: Stack,
  taskProfile?: TaskProfileLike,
): TechTier {
  const language = resolveLanguage(profile || taskProfile);
  return {
    language,
    framework: resolveFramework(profile, taskProfile),
    stack,
    runtime: resolveRuntime(stack, language),
  };
}

// ============================================
// PackageTier (per-package breakdown from decompose)
// ============================================

export interface PackageTierEntry {
  language: string;
  framework?: string;
  stack: string;
}

/**
 * Resolve task-level TechTiers (plural) from task.packages via packageTiers mapping.
 * Returns all unique TechTiers for the task's packages, preserving per-package stack info.
 *
 * Rules:
 *  - No packages or no mapping → [jobTechTier]
 *  - Deduplicate by stack+language+framework
 */
export function resolveTaskTechTiers(
  packages: string[] | undefined,
  jobTechTier: TechTier,
  packageTiers?: Record<string, PackageTierEntry>,
): TechTier[] {
  if (!packages?.length || !packageTiers || Object.keys(packageTiers).length === 0) {
    return [jobTechTier];
  }

  const resolved = packages
    .map(pkg => packageTiers[pkg])
    .filter((entry): entry is PackageTierEntry => !!entry);

  if (resolved.length === 0) return [jobTechTier];

  const seen = new Set<string>();
  const tiers: TechTier[] = [];
  for (const entry of resolved) {
    const key = `${entry.stack}|${entry.language}|${entry.framework ?? ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      tiers.push(buildTechTier(entry, entry.stack as Stack));
    }
  }
  return tiers;
}

/**
 * Compute a single representative TechTier from an array of TechTiers.
 * Used where a single TechTier is needed (language resolution, framework detection).
 *
 * Rules:
 *  - 0 tiers → empty object
 *  - 1 tier → as-is
 *  - N tiers, same stack → that stack + first language/framework
 *  - N tiers, mixed stacks → fullstack + first language/framework
 */
export function effectiveTechTier(tiers: TechTier[]): TechTier {
  if (tiers.length === 0) return {};
  if (tiers.length === 1) return tiers[0];

  const stacks = new Set(tiers.map(t => t.stack).filter(Boolean));
  const effectiveStack: Stack | undefined =
    stacks.size === 1 ? (tiers[0].stack as Stack) : 'fullstack';

  return {
    ...tiers[0],
    stack: effectiveStack,
    runtime: effectiveStack === 'fullstack' ? undefined : tiers[0].runtime,
  };
}

// ============================================
// ResolvedArtifact (materialized file content)
// ============================================

export interface ResolvedArtifact {
  path: string;
  role: 'ref' | 'context' | 'directive';
  /** Default: 'text'. When 'image', use base64/mimeType instead of content. */
  mediaType?: 'text' | 'image';
  /** Text content (mediaType='text' or omitted). */
  content: string;
  /** Image MIME type (mediaType='image'). */
  mimeType?: string;
  /** Base64-encoded image data (mediaType='image'). */
  base64?: string;
  /** @deprecated Intent-based role resolution replaces label-based matching. */
  label?: string;
}

// ============================================
// ResolvedActionContext (RAC)
// ============================================

export interface ResolvedActionContext {
  intent?: IntentId;
  intentGroup?: IntentGroup;
  mode: Mode;

  target?: string[];
  refs?: string[];
  context?: string[];

  domain?: DesignDomain;

  intentDescription?: string;

  /** Role-labeled file content (preferred field — replaces `documents`). */
  artifacts?: ResolvedArtifact[];
  /** @deprecated Use `artifacts` instead. Kept during migration for backward compat. */
  documents?: ResolvedArtifact[];

  /**
   * MCP connection sources (not prompt-injected artifacts).
   * figma.json is a bootstrap config, not a document — it belongs here, not in artifacts.
   */
  mcpSources?: {
    figma?: { fileUrl: string; fileKey: string; nodeId?: string };
  };

  source: 'explicit' | 'infer';
  hasExplicitFields: boolean;
}

// ============================================
// Artifact Accessor
// ============================================

/**
 * Read artifacts from a RAC, preferring `artifacts` field over deprecated `documents`.
 */
export function getRACDocuments(rac: ResolvedActionContext | null | undefined): ResolvedArtifact[] {
  if (!rac) return [];
  return rac.artifacts ?? rac.documents ?? [];
}

// ============================================
// Description Helpers
// ============================================

export function getIntentDescription(intent: IntentId): string | undefined {
  const def = INTENT_DEFINITIONS.find(d => d.id === intent);
  return def?.description.en;
}

// ============================================
// Unified Funnel: resolveToRAC
// ============================================

/**
 * Single entry point for RAC creation. Both explicit and infer paths converge here.
 * mode and intentGroup are ALWAYS derived from intentId — never provided as raw input.
 */
export function resolveToRAC(
  intentId: IntentId,
  slots?: {
    target?: string[];
    refs?: string[];
    context?: string[];
    domain?: DesignDomain;
  },
  source?: 'explicit' | 'infer',
): ResolvedActionContext {
  const derived = deriveFromIntent(intentId);

  return {
    intent: intentId,
    intentGroup: derived.intentGroup,
    mode: derived.mode,
    intentDescription: getIntentDescription(intentId),
    target: slots?.target,
    refs: slots?.refs,
    context: slots?.context,
    domain: slots?.domain,
    source: source ?? 'infer',
    hasExplicitFields: !!(
      slots?.target?.length || slots?.refs?.length || slots?.context?.length
    ),
  };
}

// ============================================
// Merge Helper (infer path only)
// ============================================

/** Deduplicate string array, preserving order of first occurrence. */
function dedup(arr: string[]): string[] {
  return [...new Set(arr)];
}

/**
 * Merge InferredAction with ActionMetadata supplements (infer path only).
 * Explicit path does NOT call this — metadata is already complete.
 *
 * Rules:
 *   intentId: metadata.intent replaces inferred (if present)
 *   target:   metadata.target replaces inferred (if present)
 *   refs:     additive (dedup)
 *   context:  additive (dedup)
 *   domain:   from inferred only
 */
export function mergeWithMetadata(
  inferred: InferredAction,
  metadata?: ActionMetadata,
): { intentId: string; target?: string[]; refs?: string[]; context?: string[]; domain?: DesignDomain } {
  const mergedRefs = dedup([...(inferred.refs || []), ...(metadata?.refs || [])]);
  const mergedCtx = dedup([...(inferred.context || []), ...(metadata?.context || [])]);

  return {
    intentId: metadata?.intent ?? inferred.intentId,
    target: metadata?.target?.length ? metadata.target : inferred.target,
    refs: mergedRefs.length > 0 ? mergedRefs : undefined,
    context: mergedCtx.length > 0 ? mergedCtx : undefined,
    domain: inferred.domain,
  };
}

// ============================================
// Intent-based Pipeline Helpers
// ============================================

export function isFigmaPipeline(
  intent: IntentId | undefined,
  figmaPopulated: boolean,
): boolean {
  if (intent === 'gen-ui-figma') return true;
  if (intent === 'rev-ui' && figmaPopulated) return true;
  return false;
}
