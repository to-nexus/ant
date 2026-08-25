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
import { deriveFromIntent, INTENT_DEFINITIONS, getIntentDescriptionLocalized, normalizeIntentId } from './actions';
import type { Mode, IntentGroup, Domain, InferredAction } from './detection';
import {
  filterToUiSource,
  normalizeUiSourceRefs,
  pickUiSource,
  widenHandoffRefsToBundleDir,
} from './canonical';

// ============================================
// Workspace State (minimal, for infer path)
// ============================================

export interface InferWorkspaceState {
  hasFigmaConfig?: boolean;
  hasPlan?: boolean;
  hasArchitectureSystem?: boolean;
  hasArchitectureSpec?: boolean;
  hasVisualUi?: boolean;
  targetFiles?: string[];
}

// ============================================
// TechTier
// ============================================

import type { SupportedLanguage } from './tech-tier-registry';

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
  /** Phase 1: game-domain sub-engine slot. v7 (D29) — single registered variant `'phaser'`; Phase 5+ widens the candidate set. */
  gameEngine?: GameEngine;
}

/**
 * Game engine — the 5th slot inside `TechTier` (game domain only).
 *
 * v7 (D29) — registry single-element: `'phaser'`. Phase 5+ hook will widen
 * the union when additional engines (godot / cocos-creator / babylon /
 * three) re-enter the candidate set. The matrix gate
 * (`TIER_DOMAIN_MATRIX.techTier` combined with `domain === 'game'`) decides
 * when this slot is even consulted.
 */
export type GameEngine = 'phaser';

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

/**
 * v10 — genre-neutral art-style archetypes, curated to span the real
 * game-art landscape (Champlain / Pixune / RocketBrush taxonomy:
 * production × rendering × thematic layers) at the same breadth level as
 * the service-UI `visualLanguage` (20 design languages). These replace the
 * v9 5-concept genre-tinged set (`flatMinimal`/`pixelRetro`/`neonArcade`/
 * `softPastel`/`cardClassic`), which under-represented the traditional
 * fantasy-RPG territory (16-bit JRPG / hand-painted high-fantasy /
 * dark-fantasy).
 *
 * Each concept is a single coherent NAMED style (production + theme bundled),
 * NOT an orthogonal axis. It is a MINIMAL design guide / seed — used when
 * bootstrapping a handoff or coding with no art reference; it yields to a
 * real art reference (figma / ant-json / handoff) via the gameArtTier concept
 * suppressor (`shouldEmitGameArtConcept` in tier-matrix.ts). Same standing as
 * the service-UI concept.
 *
 * Fantasy-RPG coverage: `pixelJRPG` (16-bit) + `paintedFantasy` (hand-painted
 * high-fantasy) + `darkGothic` (dark-fantasy) + `stylizedReal`
 * (fantasy-realism).
 */
export type GameArtConceptVariant =
  | 'flatVector'
  | 'pixelArcade'
  | 'pixelJRPG'
  | 'paintedFantasy'
  | 'celToon'
  | 'handDrawnStorybook'
  | 'lowPolyGeo'
  | 'neonSynth'
  | 'softCozy'
  | 'darkGothic'
  | 'stylizedReal';
/**
 * Render dimension. `'2d'` → plain Phaser; `'3d'` → Phaser + the enable3d
 * extension (three.js render + ammo.js physics), which supplies code-only
 * built-in primitives (box / sphere / ground / …) so a 3D game needs no
 * imported model assets. The engine stays `gameEngine='phaser'` for both —
 * perspective is the single owner of the 2D↔3D decision.
 */
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

export interface Basis {
  techTier?: TechTierConfig;
  visualTier?: VisualTier;
  /** Phase 2 — game-domain art tier (gated by `TIER_DOMAIN_MATRIX.gameArtTier`). */
  gameArtTier?: GameArtTier;
  /**
   * Service Virtualization build decision (§4). Decompose emits a
   * `<serviceVirtualization>` tag (default `build`); `optedOut: true` means the
   * user asked for the real backend only and SV generation is suppressed.
   * Absent ⇒ not opted out (build). Service-domain only.
   */
  serviceVirtualization?: { optedOut: boolean };
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
  if (raw.includes('html')) return 'html';
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
// Per-task TechTier resolution (stack pointer → config slot)
// ============================================

/**
 * Resolve a single task's TechTier[] from its `stack` pointer + the job-level
 * TechTierConfig. Task-level `stack` is always single (never fullstack):
 *  - No config → []
 *  - `stack` given → `[config[stack]]` (or [] if that slot is empty)
 *  - `stack` omitted → the sole configured tier (`frontend ?? backend`). If the
 *    config has BOTH (fullstack) while `stack` is omitted, that is an LLM
 *    contract violation — warn and fall back to the first available tier.
 */
export function resolveTaskTechTierFromStack(
  stack: 'frontend' | 'backend' | undefined,
  techTierConfig: TechTierConfig | undefined,
): TechTier[] {
  if (!techTierConfig) return [];
  const { frontend, backend } = techTierConfig;

  if (stack) {
    const tier = techTierConfig[stack];
    return tier ? [tier] : [];
  }

  if (frontend && backend) {
    console.warn(
      '⚠️ [TechTier] task.stack omitted but config has both frontend and backend; ' +
      'defaulting to frontend (LLM must set task.stack on fullstack jobs).',
    );
    return [frontend];
  }
  const sole = frontend ?? backend;
  return sole ? [sole] : [];
}

/**
 * Apply explicit (preset) techTier overrides on top of resolved task tiers.
 *
 * Policy: explicit fields from `actionMetadata.basis.techTier` are authoritative
 * — they win over any value emitted by the LLM in `<techTier>`. Mirrors the
 * `visualTier` / `gameArtTier` invariant.
 *
 * Behavior:
 *  - `explicit` undefined → return input unchanged (infer path).
 *  - For each task tier, if `explicit.{frontend|backend}` matches `tier.stack`,
 *    explicit fields (language / framework / packageManager / gameEngine) are
 *    merged onto the tier with explicit-first precedence.
 *  - Stacks not pinned by explicit are returned unchanged.
 */
export function applyExplicitTechTierOverrides(
  taskTiers: TechTier[],
  explicit: TechTierConfig | undefined,
): TechTier[] {
  if (!explicit) return taskTiers;
  return taskTiers.map(tier => {
    const e =
      tier.stack === 'frontend' ? explicit.frontend
      : tier.stack === 'backend' ? explicit.backend
      : undefined;
    if (!e) return tier;
    return {
      ...tier,
      language: e.language ?? tier.language,
      framework: e.framework ?? tier.framework,
      packageManager: e.packageManager ?? tier.packageManager,
      gameEngine: e.gameEngine ?? tier.gameEngine,
    };
  });
}

/**
 * Merge a decompose gameArtTier emission into the carried basis with explicit
 * axes authoritative.
 *
 * Policy: explicit axes from `actionMetadata.basis.gameArtTier` (the user's
 * wizard selection) win over anything the LLM emitted in `<gameArtTier>` or the
 * default-on-retry-exhaustion fill — a user-pinned axis (e.g. `perspective=3d`)
 * is never downgraded. The LLM emit only supplies axes the explicit basis lacks.
 * Mirrors `applyExplicitTechTierOverrides`.
 *
 * Precedence (last wins): `carried` < `emitted` < `explicit`.
 */
export function applyExplicitGameArtTierOverrides(
  carried: GameArtTier | undefined,
  emitted: GameArtTier,
  explicit: GameArtTier | undefined,
): GameArtTier {
  return { ...(carried ?? {}), ...emitted, ...(explicit ?? {}) };
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
  /**
   * Byte class from the content sniff performed at pool load. `'binary'` marks an
   * existence-only stub: `content` is the `[asset]` manifest line, never the bytes.
   *
   * This is the SSOT every downstream layer keys off instead of re-deriving
   * "is this a real file I may place?" from a directory prefix — the ride-along
   * exemption in `ArtifactPipeline.selectArtifacts`, the placeable-file inventory,
   * and the image-block builder all read it. Absent on artifacts produced before
   * the sniff (treat as `'text'`).
   */
  kind?: 'binary' | 'text';
  /** On-disk size in bytes, from the same sniff that set `kind`. */
  sizeBytes?: number;
  /** @deprecated Intent-based role resolution replaces label-based matching. */
  label?: string;

  // ── Compaction metadata (populated by `compactArtifacts` when content
  //    exceeds the per-artifact threshold and is replaced with a
  //    line-numbered outline). All fields are optional and absent on
  //    artifacts that pass through unchanged. Adding these fields is a
  //    non-breaking extension — existing consumers ignore them; prompt
  //    templates can branch on `wasCompacted` to render a
  //    `· compacted` marker plus a `read_file` access hint.
  /** True when content was passed through `compactContent` and replaced with an outline. */
  wasCompacted?: boolean;
  /** Original character count before compaction. Undefined when `wasCompacted=false`. */
  originalChars?: number;
  /** Character count after compaction (= `content.length` when `wasCompacted=true`). */
  compactedChars?: number;
}

// ============================================
// ResolvedActionContext (RAC)
// ============================================

/**
 * A cross-project code reference target. Points at a sibling ANT project (same
 * tenant) and, optionally, a git ref. `branch` is a raw git ref; when omitted it
 * resolves to the project's `branchBase`. An ant feature maps to the git branch
 * of the same name (branch == feature name, no prefix). The reference tools
 * (`register_reference` / `read_reference_file` / `list_reference_files` /
 * `search_reference_code`) read (never write) this project's codebase.
 */
export interface ReferenceTarget {
  project: string;
  branch?: string;
}

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

  /**
   * Cross-project code references the user pinned explicitly in the action.
   * Seeded into `state.referenceRequests` at resolve, unioned with entries the
   * LLM registers at runtime (`register_reference` tool) or at decompose
   * (`<references>` tag). Does NOT count toward `hasExplicitFields` /
   * `computeRacScope` — it is orthogonal to the current-feature RAC whitelist.
   */
  referenceTargets?: ReferenceTarget[];

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
 *
 * Hard-exclusive UiSource invariant is enforced here via `normalizeUiSourceRefs`
 * (canonical.ts SSOT) — refs / context are filtered down to a single
 * UiSource (ant > figma > handoff) before being attached to the RAC. This
 * makes the downstream `validateUiSourceExclusivity` (loadDocumentsForRAC)
 * a safety net rather than the primary enforcer; if it ever throws, a
 * caller has bypassed this funnel.
 *
 * Handoff bundle-root invariant is owned here too via
 * `widenHandoffRefsToBundleDir` (canonical.ts SSOT) — a handoff bundle is one
 * indivisible selection unit, so any handoff-classified ref/context entry is
 * widened to its bundle root dir (`visual/{ui,game-art}/handoff`), converging
 * the explicit path with the infer path's bundle-dir shape. `target` widens
 * only in refactor mode (revise mirrors refs); generate producers' canonical
 * output-spec target lists stay verbatim.
 */
export function resolveToRAC(
  intentId: IntentId,
  slots?: {
    target?: string[];
    refs?: string[];
    context?: string[];
    domain?: Domain;
    referenceTargets?: ReferenceTarget[];
  },
  source?: 'explicit' | 'infer',
  basis?: Basis,
): ResolvedActionContext {
  // Retired ids (see LEGACY_INTENT_ALIASES) never reach a freshly minted RAC.
  intentId = normalizeIntentId(intentId);
  const derived = deriveFromIntent(intentId);

  const refs = slots?.refs?.length
    ? widenHandoffRefsToBundleDir(normalizeUiSourceRefs(slots.refs))
    : slots?.refs;
  const context = slots?.context?.length
    ? widenHandoffRefsToBundleDir(normalizeUiSourceRefs(slots.context))
    : slots?.context;
  const target = derived.mode === 'refactor'
    ? widenHandoffRefsToBundleDir(slots?.target)
    : slots?.target;

  // Domain-aware intent description (parity with FE labels). The base
  // `description` is domain-neutral; `descriptionByDomain` branches per
  // domain (currently `game`). Service / no-override domains fall through
  // to the neutral base, so this is a no-op for non-branched domains and
  // reaches the prompt via `action-context.md`.
  const intentDef = INTENT_DEFINITIONS.find(d => d.id === intentId);

  return {
    intent: intentId,
    intentGroup: derived.intentGroup,
    mode: derived.mode,
    intentDescription: intentDef
      ? getIntentDescriptionLocalized(intentDef, slots?.domain, 'en')
      : getIntentDescription(intentId),
    target,
    refs,
    context,
    domain: slots?.domain,
    basis,
    // Cross-project references are orthogonal to the current-feature RAC
    // whitelist — deliberately NOT counted in `hasExplicitFields`.
    referenceTargets: slots?.referenceTargets?.length ? slots.referenceTargets : undefined,
    source: source ?? 'infer',
    hasExplicitFields: !!(
      slots?.target?.length || refs?.length || context?.length
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
 *   refs:     additive (dedup) → normalized to single UiSource
 *   context:  additive (dedup) → normalized to single UiSource
 *   domain:   from inferred only
 *   basis:    from metadata only (explicit preset from UI)
 *
 * Exclusivity: exactly one UiSource survives, decided ONCE over refs ∪ context
 * and then applied to both slots (`pickUiSource` + `filterToUiSource`).
 *
 * Source precedence: exclusivity means a source gets dropped, and the static
 * priority (`ant > figma > handoff`) knows nothing about who contributed which
 * path. Deciding blind deletes a source the USER selected in favour of one
 * inference guessed at — an attached handoff screenshot losing to an inferred
 * `visual/ui/ant` doc. So the source present in `metadata` is the preference and
 * outranks the static order here. `resolveToRAC` keeps the plain static order:
 * its inputs are already single-authority by the time they reach it.
 */
export function mergeWithMetadata(
  inferred: InferredAction,
  metadata?: ActionMetadata,
): { intentId: string; target?: string[]; refs?: string[]; context?: string[]; domain?: Domain; basis?: Basis; referenceTargets?: ReferenceTarget[] } {
  const refsUnion = dedup([...(inferred.refs || []), ...(metadata?.refs || [])]);
  const ctxUnion = dedup([...(inferred.context || []), ...(metadata?.context || [])]);
  // ONE verdict over refs ∪ context, then applied to both slots. Deciding per
  // slot would let `refs` (holding only the inferred `ant` doc) keep `ant` while
  // `context` resolves to the attached `handoff` — a mixed RAC, which is the
  // very thing the exclusivity invariant forbids.
  const winner = pickUiSource([...refsUnion, ...ctxUnion], pickUiSource(
    [...(metadata?.refs || []), ...(metadata?.context || [])],
  ));
  const mergedRefs = filterToUiSource(refsUnion, winner);
  const mergedCtx = filterToUiSource(ctxUnion, winner);

  // Explicit > infer (10.2 invariant): ActionMetadata.domain wins when present.
  const domain = metadata?.domain ?? inferred.domain;

  return {
    intentId: metadata?.intent ?? inferred.intentId,
    target: metadata?.target?.length ? metadata.target : inferred.target,
    refs: mergedRefs.length > 0 ? mergedRefs : undefined,
    context: mergedCtx.length > 0 ? mergedCtx : undefined,
    domain,
    basis: metadata?.basis,
    referenceTargets: metadata?.referenceTargets?.length ? metadata.referenceTargets : undefined,
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
  if (intent === 'gen-ui-figma' || intent === 'gen-game-art-figma') return true;
  // Both surfaces are symmetric (I10): a figma-sourced revise compiles the
  // workfile into the surface's ant trio. `rev-game-art` was missing here, so a
  // game-art figma ref had no execution path even after being selected.
  if ((intent === 'rev-ui' || intent === 'rev-game-art') && figmaPopulated) return true;
  return false;
}
