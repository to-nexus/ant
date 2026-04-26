/**
 * ResolvedActionContext (RAC) — Progressive Action Specification
 *
 * Progressively resolved across detect → decompose:
 *   detect:    intent, mode, intentGroup, slots (target/refs/context), domain
 *   detect+:   artifacts (파일 로드 후)
 *   decompose: basis.techTier (TechTierConfig: { stack, frontend?, backend? })
 *
 * basis.techTier는 explicit(@-멘션)이면 detect에서, 아니면 decompose에서 확정.
 * basis.visualTier는 향후 추론 로직 추가 예정 (구조만 확보).
 *
 * Created via resolveToRAC() — the single unified funnel for both
 * explicit and infer paths. mode/intentGroup are always derived from
 * intentId via deriveFromIntent(), never provided as raw input.
 */

import type { ActionMetadata, IntentId } from './actions';
import { deriveFromIntent, INTENT_DEFINITIONS } from './actions';
import type { Mode, IntentGroup, Domain, InferredAction } from './detection';

// ============================================
// Workspace State (minimal, for infer path)
// ============================================

export interface InferWorkspaceState {
  hasFigmaConfig?: boolean;
  hasPrd?: boolean;
  hasDesignDoc?: boolean;
  hasSpecDocs?: boolean;
  targetFiles?: string[];
}

// ============================================
// TechTier
// ============================================

import type { SupportedLanguage, TechTierKey } from './tech-tier-registry';

export type Language = SupportedLanguage;
export type Stack = 'frontend' | 'backend' | 'fullstack';

/**
 * Individual technology tier — describes a single tier slot (frontend OR backend).
 * TechTier.stack is TechTierKey (frontend | backend), NOT fullstack.
 * fullstack only exists on TechTierConfig.stack as a project structure indicator.
 *
 * Game-domain extension (Phase 1, opt-in):
 *   - `gameEngine` is the 5th slot. When set (e.g. `'phaser'`), the basis
 *     section additionally injects the engine-specific partial. Independent
 *     of `framework` because in `react+phaser` the host is React and the
 *     sub-engine is Phaser; both must inject simultaneously.
 */
export interface TechTier {
  language?: Language;
  framework?: string;
  stack?: Stack;
  packageManager?: 'npm' | 'yarn' | 'pnpm' | 'bun';
  /** Phase 1: game-domain sub-engine slot ('phaser' | 'godot' | 'cocos-creator'). */
  gameEngine?: GameEngine;
}

/**
 * Game engine — the 5th slot inside `TechTier` (game domain only).
 *
 * Phase 2 ships `phaser` as the only fully implemented engine; `godot` and
 * `cocos-creator` are stubs. The matrix gate (`TIER_DOMAIN_MATRIX.techTier`
 * combined with `domain === 'game'`) decides when this slot is even
 * consulted.
 */
export type GameEngine = 'phaser' | 'godot' | 'cocos-creator';

/**
 * Aggregated tech tier configuration — stack + per-side tiers.
 * Lives on Basis.techTier.
 */
export interface TechTierConfig {
  stack?: Stack;
  frontend?: TechTier;
  backend?: TechTier;
}

// ============================================
// VisualTier (6-layer visual design policy)
// ============================================

export type VisualLanguageVariant =
  | 'modernSaas' | 'enterprise' | 'fintechPremium' | 'devtoolDark' | 'minimalNeutral'
  | 'crispMinimal' | 'cleanBright' | 'neutralPro' | 'warmNatural' | 'softClay'
  | 'bentoModern' | 'deepMuted' | 'darkLuxury' | 'cinematicDark'
  | 'boldPlayful' | 'neoBrutalist' | 'editorialBold' | 'cyberpunkNeon' | 'retroFuture'
  | 'nexusDS';
export type SurfaceSystemVariant = 'solid' | 'soft' | 'borderedSoft' | 'tinted' | 'glassLight';
export type SpatialSystemVariant = 'compact8pt' | 'balanced8pt' | 'airy8pt' | 'dense12ptHybrid';
export type InteractionGrammarVariant = 'restrained' | 'subtleProduct' | 'calmPremium' | 'rawInstant' | 'cinematicReveal' | 'expressivePlayful';
export type ComponentSemanticsVariant = 'metricFirst' | 'actionGuided' | 'contentPreview' | 'utilityPanel';
export type VisualHierarchyRulesVariant = 'controlledFocus' | 'taskPriority' | 'summaryFirst' | 'quietLayered';

export interface VisualTier {
  designSystem?: string;
  visualLanguage?: VisualLanguageVariant;
  surfaceSystem?: SurfaceSystemVariant;
  spatialSystem?: SpatialSystemVariant;
  interactionGrammar?: InteractionGrammarVariant;
  componentSemantics?: ComponentSemanticsVariant;
  visualHierarchyRules?: VisualHierarchyRulesVariant;
}

// ============================================
// GameArtTier — game-domain art policy (7 axis)
// ============================================
//
// Phase 1 declared the full 7-axis shape so future-domain extensions stay
// non-breaking. Phase 2 fills `concept` / `perspective` only; Phase 4 fills
// the remaining 5 axis. The matrix gate (`TIER_DOMAIN_MATRIX.gameArtTier`)
// allows only `'game'` (D12-revised — game-only naming, future non-game
// art-heavy domains will get their own tier or rename when they arrive).
//
// Naming intent (D3): `concept` (not `visualLanguage`) so semantic collision
// with `VisualTier.visualLanguage` is impossible — the two tiers describe
// different surfaces (React/HUD vs. engine-internal art).
//
// Motion locality (I5):
//   - `interactionGrammar` (visualTier) = UI/HUD page transitions / hover
//   - `motionPattern` (gameArtTier) = sprite tween / sprite animation / camera shake
//   - particle / projectile motion → `particleProfile` / `projectilePolicy`

export type GameArtConceptVariant =
  | 'sfFantasy' | 'darkFantasy' | 'threeKingdoms' | 'martialArts'
  | 'modernCasual' | 'pixelRetro';
export type GameArtPerspectiveVariant = '2d' | '3d';
export type GameArtEntityCatalogVariant = 'minimal' | 'standard' | 'rich';
export type GameArtMotionPatternVariant = 'static' | 'subtle' | 'expressive';
export type GameArtParticleProfileVariant = 'none' | 'light' | 'heavy';
export type GameArtProjectilePolicyVariant = 'none' | 'simple' | 'complex';
export type GameArtAudioProfileVariant = 'procedural' | 'fileBased' | 'hybrid';

export interface GameArtTier {
  /** Phase 2 — tone / silhouette / lighting palette. */
  concept?: GameArtConceptVariant;
  /** Phase 2 — camera / depth / input mapping. */
  perspective?: GameArtPerspectiveVariant;
  /** Phase 4 — character / object catalog policy. */
  entityCatalog?: GameArtEntityCatalogVariant;
  /** Phase 4 — sprite tween / animation policy. */
  motionPattern?: GameArtMotionPatternVariant;
  /** Phase 4 — particle system guidance. */
  particleProfile?: GameArtParticleProfileVariant;
  /** Phase 4 — projectile / bullet policy. */
  projectilePolicy?: GameArtProjectilePolicyVariant;
  /** Phase 4 — audio policy (procedural / fileBased / hybrid). */
  audioProfile?: GameArtAudioProfileVariant;
}

// ============================================
// GameContentTier — game-only content policy
// ============================================

export type GameGenreVariant =
  | 'action' | 'puzzle' | 'platformer' | 'shooter'
  | 'rpg' | 'strategy' | 'casual';
export type GameCoreLoopVariant = 'collect' | 'fight' | 'build' | 'explore' | 'solve';

export interface GameContentTier {
  /** Phase 2 — genre identity (puzzle, action, ...). */
  genre?: GameGenreVariant;
  /** Phase 2 — core loop pattern (collect / fight / build / explore / solve). */
  coreLoop?: GameCoreLoopVariant;
}

export interface Basis {
  techTier?: TechTierConfig;
  visualTier?: VisualTier;
  /** Phase 2 — game-domain art tier (gated by `TIER_DOMAIN_MATRIX.gameArtTier`). */
  gameArtTier?: GameArtTier;
  /** Phase 1 — game-domain content tier (genre + coreLoop). */
  gameContentTier?: GameContentTier;
}

// ============================================
// Basis Options — re-exported from tech-tier-registry
// ============================================

export {
  type BasisOption,
  STACK_OPTIONS,
  TECH_TIER_LANGUAGES,
  VISUAL_TIER_DESIGN_SYSTEMS,
} from './tech-tier-registry';

// Visual-tier registry symbols are exported from package root via index.ts
// (`export * from './visual-tier-registry'`). Re-exporting here would create a
// rac ↔ visual-tier-registry circular dependency (lint: import/no-cycle).

export function buildBasisPreset(opts: {
  stack?: string;
  tiers?: Partial<Record<string, { language?: string; framework?: string; packageManager?: string; gameEngine?: GameEngine }>>;
  designSystem?: string;
  visualTier?: {
    visualLanguage?: VisualLanguageVariant;
    surfaceSystem?: SurfaceSystemVariant;
    spatialSystem?: SpatialSystemVariant;
  };
  /** Phase 2 — game-domain art tier (concept / perspective fillable from wizard). */
  gameArtTier?: GameArtTier;
  /** Phase 1 — game-domain content tier (genre / coreLoop fillable from wizard). */
  gameContentTier?: GameContentTier;
}): Basis {
  const tierEntries: Record<string, TechTier> = {};
  if (opts.tiers) {
    for (const [key, val] of Object.entries(opts.tiers)) {
      if (val?.language || val?.gameEngine) {
        tierEntries[key] = {
          language: val.language as Language | undefined,
          framework: val.framework,
          stack: key as Stack,
          packageManager: val.packageManager as TechTier['packageManager'],
          gameEngine: val.gameEngine,
        };
      }
    }
  }
  const hasTiers = Object.keys(tierEntries).length > 0;
  const hasVisualLayers = opts.visualTier && Object.values(opts.visualTier).some(Boolean);
  const gameArtInput = opts.gameArtTier;
  const hasGameArtAxis = gameArtInput && Object.values(gameArtInput).some(Boolean);
  const hasGameContentAxis = opts.gameContentTier && Object.values(opts.gameContentTier).some(Boolean);

  return {
    techTier: (opts.stack || hasTiers) ? {
      stack: opts.stack as Stack | undefined,
      ...(hasTiers ? tierEntries : {}),
    } as TechTierConfig : undefined,
    visualTier: (opts.designSystem || hasVisualLayers) ? {
      ...(opts.designSystem ? { designSystem: opts.designSystem } : {}),
      ...(hasVisualLayers ? opts.visualTier : {}),
    } : undefined,
    gameArtTier: hasGameArtAxis ? { ...gameArtInput } : undefined,
    gameContentTier: hasGameContentAxis ? { ...opts.gameContentTier } : undefined,
  };
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
 * Resolve task-level TechTiers from TechTierConfig + packageTiers mapping.
 * Returns TechTier[] for the task's packages, preserving per-package stack info.
 *
 * Rules:
 *  - No config → []
 *  - No packages or no mapping → all tiers from config
 *  - Package-based: lookup by stack key, deduplicate
 */
export function resolveTaskTechTiersFromMap(
  packages: string[] | undefined,
  techTierConfig: TechTierConfig | undefined,
  packageTiers?: Record<string, PackageTierEntry>,
): TechTier[] {
  if (!techTierConfig) return [];
  const { frontend, backend } = techTierConfig;
  const allTiers = [frontend, backend].filter((t): t is TechTier => !!t);
  if (!packages?.length || !packageTiers || Object.keys(packageTiers).length === 0) {
    return allTiers;
  }

  const VALID_KEYS: TechTierKey[] = ['frontend', 'backend'];
  const seen = new Set<TechTierKey>();
  const result: TechTier[] = [];
  for (const pkg of packages) {
    const entry = packageTiers[pkg];
    if (!entry) continue;
    const key = VALID_KEYS.find(k => k === entry.stack);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const configTier = techTierConfig[key];
    result.push({
      language: (entry.language as Language) || configTier?.language,
      framework: entry.framework || configTier?.framework,
      stack: key,
      packageManager: configTier?.packageManager,
    });
  }
  return result.length > 0 ? result : allTiers;
}

/** @deprecated Use resolveTaskTechTiersFromMap instead */
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
 *  - N tiers, mixed stacks → stack undefined + first language/framework
 */
export function effectiveTechTier(tiers: TechTier[]): TechTier {
  if (tiers.length === 0) return {};
  if (tiers.length === 1) return tiers[0];

  const stacks = new Set(tiers.map(t => t.stack).filter(Boolean));
  const effectiveStack: Stack | undefined =
    stacks.size === 1 ? (tiers[0].stack as Stack) : undefined;

  return {
    ...tiers[0],
    stack: effectiveStack,
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

  /**
   * Project domain — universal across artifact-producing jobs.
   * Phase 1: `'service' | 'game'`. Phase 4+ may extend (`'3d'`, ...).
   * Populated either via:
   *   - explicit ActionMetadata.domain (UI DomainToggle / `@domain:` mention)
   *   - design / plan strategy LLM `<domain>` output (infer path)
   */
  domain?: Domain;

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

  /** Progressive basis — techTier populated by decompose (or explicit preset), visualTier reserved. */
  basis?: Basis;

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
    domain?: Domain;
  },
  source?: 'explicit' | 'infer',
  basis?: Basis,
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
    basis,
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
 *   basis:    from metadata only (explicit preset from UI)
 */
export function mergeWithMetadata(
  inferred: InferredAction,
  metadata?: ActionMetadata,
): { intentId: string; target?: string[]; refs?: string[]; context?: string[]; domain?: Domain; basis?: Basis } {
  const mergedRefs = dedup([...(inferred.refs || []), ...(metadata?.refs || [])]);
  const mergedCtx = dedup([...(inferred.context || []), ...(metadata?.context || [])]);

  // Explicit > infer (10.2 invariant): ActionMetadata.domain wins when present.
  const domain = metadata?.domain ?? inferred.domain;

  return {
    intentId: metadata?.intent ?? inferred.intentId,
    target: metadata?.target?.length ? metadata.target : inferred.target,
    refs: mergedRefs.length > 0 ? mergedRefs : undefined,
    context: mergedCtx.length > 0 ? mergedCtx : undefined,
    domain,
    basis: metadata?.basis,
  };
}

// ============================================
// Intent-based Pipeline Helpers
// ============================================

// ============================================
// mergeTechTierConfigs (additive merge for infer+preset)
// ============================================

/**
 * Additively merge two TechTierConfigs.
 * Preset fields take priority; missing fields are filled from inferred.
 */
export function mergeTechTierConfigs(
  preset?: TechTierConfig,
  inferred?: TechTierConfig,
): TechTierConfig {
  if (!preset) return inferred ?? {};
  if (!inferred) return preset;
  const result: TechTierConfig = { stack: preset.stack ?? inferred.stack };
  for (const key of ['frontend', 'backend'] as const) {
    const p = preset[key];
    const i = inferred[key];
    if (p && i) {
      result[key] = {
        language: p.language ?? i.language,
        framework: p.framework ?? i.framework,
        stack: key as Stack,
        packageManager: p.packageManager ?? i.packageManager,
        // Phase 1 — gameEngine 5th slot. Preset wins (user explicitly set
        // it via wizard / mention), otherwise the inferred LLM choice.
        gameEngine: p.gameEngine ?? i.gameEngine,
      };
    } else if (p) {
      result[key] = p;
    } else if (i) {
      result[key] = { ...i, stack: key as Stack };
    }
  }
  return result;
}

/** @deprecated Use mergeTechTierConfigs instead */
export function mergeTechTier(
  preset?: TechTier,
  inferred?: TechTier,
): TechTier {
  if (!preset) return inferred ?? {};
  if (!inferred) return preset;
  return {
    language:       preset.language       ?? inferred.language,
    framework:      preset.framework      ?? inferred.framework,
    stack:          preset.stack          ?? inferred.stack,
    packageManager: preset.packageManager ?? inferred.packageManager,
  };
}

// ============================================
// State Accessor Helpers
// ============================================

/** Structural type — ArchitectGraphState, DesignGraphState 등 모두 호환 */
interface HasResolvedAction {
  resolvedAction?: ResolvedActionContext;
}

/**
 * Read effective TechTier from RAC basis (TechTierConfig).
 * Returns frontend tier as default for single-tier or fullstack (frontend priority).
 * For both tiers, access basis.techTier.frontend / .backend directly.
 */
export function getTechTier(state: HasResolvedAction): TechTier | undefined {
  const config = state.resolvedAction?.basis?.techTier;
  if (!config) return undefined;
  const { frontend, backend } = config;
  const entries = [frontend, backend].filter((t): t is TechTier => !!t);
  if (entries.length === 0) return undefined;
  return entries[0];
}

/** Read the full Basis from RAC. */
export function getBasis(state: HasResolvedAction): Basis | undefined {
  return state.resolvedAction?.basis;
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
