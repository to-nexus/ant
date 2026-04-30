/**
 * ArtifactPipeline
 *
 * Unified artifact selection + compaction pipeline.
 * Replaces per-caller documentResolver / designSelector / manual wrapping.
 *
 * Three public functions form the pipeline:
 *   selectArtifacts  — filter candidates by include patterns or taskType defaults
 *   compactArtifacts — shrink oversized artifacts to outline + tool hint
 *   resolveArtifacts — convenience: select then compact
 *
 * Pool extraction helpers (Phase 2):
 *   flattenDesignArtifacts — name→content map from system-design artifacts
 *   getDesignDocByPackageFromPool — lookup by package tag
 *   extractFirstDesign — first system-design artifact content
 *   hasSourceArtifact / getSourceContent — source/prd artifact access
 *
 * ── Post-RAC template flag categories (SSOT for .cursorrules) ──
 *
 * `ArtifactPoolView` exposes THREE flavours of presence check; template
 * authors pick by WHAT the gated block enforces, not by the role the
 * artifact happens to carry today:
 *
 *   Gate     — `hasUi`, `hasSystemDesign`, `hasSpec`, `hasSources`
 *              "An artifact of this kind exists in the post-RAC pool."
 *              Use for task-decomposition branching, inventory guides,
 *              or any block whose semantics are IDENTICAL for ref and
 *              context roles. DEFAULT choice when unsure.
 *
 *   Contract — `hasUiRef`, `hasSystemDesignRef`, `hasSpecRef`,
 *              `hasSourcesRef`
 *              "An authoritative artifact (`role='ref'`) exists and
 *              the block's language enforces conformance (MUST /
 *              IMMUTABLE)." Use ONLY when the copy explicitly states
 *              the doc is an immutable contract.
 *
 *   Background — `hasUiContext`, `hasSystemDesignContext`, ...
 *              "A `role='context'` artifact exists; the block treats
 *              it as background/reference material, not a contract."
 *              Currently reserved for future use-sites; no active
 *              template consumers today.
 *
 * The intent matrix in `@ant/shared/action-config-matrix.ts` assigns
 * different roles to the same artifact kind across intents
 * (e.g. UI=ref for `gen-code-sys`, UI=context for `gen-code-spec`),
 * so template blocks that branch on "UI is available" belong in the
 * Gate category — not Contract.
 */

import type { ResolvedArtifact, UiSource } from '@ant/shared';
import { ARTIFACT_PREFIX, uiSourceOfPath, gameArtSourceOfPath } from '@ant/shared';
import { compactContent } from '../utils/contentCompactor';

// ────────────────────────────────────────────────────────────────
// UI / game-art artifact recognition
// ────────────────────────────────────────────────────────────────

/**
 * An artifact counts as "UI" if it lives under ANY of the three UiSource
 * subdirectories: `visual/ui/{ant,figma,handoff}/`. The parent
 * `visual/ui/` directory is NOT sufficient on its own — paths must resolve
 * to a specific UiSource.
 */
export function isUiArtifactPath(p: string): boolean {
  return p.startsWith(ARTIFACT_PREFIX.UI_ANT)
    || p.startsWith(ARTIFACT_PREFIX.UI_FIGMA)
    || p.startsWith(ARTIFACT_PREFIX.UI_HANDOFF);
}

/**
 * An artifact counts as "game-art" if it lives under any of the three
 * game-art sub-source subdirectories: `visual/game-art/{ant,figma,handoff}/`.
 * Mirrors `isUiArtifactPath` shape (D24-revised).
 */
export function isGameArtArtifactPath(p: string): boolean {
  return gameArtSourceOfPath(p) !== null;
}

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

export interface ArtifactSelectionPolicy {
  taskType?: string;
  /** Path prefix patterns. Glob-style trailing `*` supported. */
  include?: string[];
}

export interface ArtifactCompactionConfig {
  /** Character count; artifacts above this are compacted to outline. */
  threshold: number;
  /** Tool name shown in the read hint. Default: 'read_file'. */
  toolHint?: string;
}

// ────────────────────────────────────────────────────────────────
// Selection
// ────────────────────────────────────────────────────────────────

function matchesInclude(artifactPath: string, patterns: string[]): boolean {
  return patterns.some(pattern => {
    if (pattern.endsWith('*')) {
      return artifactPath.startsWith(pattern.slice(0, -1));
    }
    return artifactPath === pattern || artifactPath.startsWith(pattern);
  });
}

/**
 * Filter candidate artifacts by policy.
 *
 * Priority:
 * 1. `taskType: 'verification'` → always empty (no docs needed)
 * 2. `include` present → exact path-prefix match
 * 3. taskType-based default rules (backward-compatible fallback)
 */
export function selectArtifacts(
  candidates: ResolvedArtifact[],
  policy: ArtifactSelectionPolicy,
): ResolvedArtifact[] {
  if (policy.taskType === 'verification') return [];

  if (policy.include?.length) {
    return candidates.filter(a => matchesInclude(a.path, policy.include!));
  }

  // taskType-based defaults (backward compat when include is absent)
  switch (policy.taskType) {
    case 'error':
      if (candidates.some(a => a.path.startsWith(ARTIFACT_PREFIX.SPEC))) {
        return candidates.filter(
          a => a.path.startsWith(ARTIFACT_PREFIX.SPEC) ||
               a.path.startsWith(ARTIFACT_PREFIX.API_CONTRACT),
        );
      }
      return [];

    case 'ui':
    case 'design-system':
      return candidates.filter(a => isUiArtifactPath(a.path));

    default:
      return candidates.filter(
        a =>
          a.path.startsWith(ARTIFACT_PREFIX.SYSTEM_DESIGN) ||
          a.path.startsWith(ARTIFACT_PREFIX.SPEC) ||
          isUiArtifactPath(a.path) ||
          isGameArtArtifactPath(a.path) ||
          a.path.startsWith(ARTIFACT_PREFIX.SOURCES),
      );
  }
}

/**
 * Select artifacts with explicit role assignment from policy.
 * Refs patterns are matched first; context patterns skip already-seen paths.
 */
export function selectArtifactsWithPolicy(
  candidates: ResolvedArtifact[],
  policy: { refs?: string[]; context?: string[] },
): ResolvedArtifact[] {
  const result: ResolvedArtifact[] = [];
  const seen = new Set<string>();

  for (const pattern of policy.refs ?? []) {
    for (const a of candidates) {
      if (!seen.has(a.path) && matchesInclude(a.path, [pattern])) {
        result.push({ ...a, role: 'ref' });
        seen.add(a.path);
      }
    }
  }
  for (const pattern of policy.context ?? []) {
    for (const a of candidates) {
      if (!seen.has(a.path) && matchesInclude(a.path, [pattern])) {
        result.push({ ...a, role: 'context' });
        seen.add(a.path);
      }
    }
  }
  return result;
}

/**
 * Flatten an artifactPolicy into a simple include string[].
 * Used for backward-compat when only path prefixes (no roles) are needed.
 */
export function flattenPolicyToInclude(
  policy?: { refs?: string[]; context?: string[] },
): string[] | undefined {
  if (!policy) return undefined;
  const all = [...(policy.refs || []), ...(policy.context || [])];
  return all.length > 0 ? all : undefined;
}

// ────────────────────────────────────────────────────────────────
// Compaction
// ────────────────────────────────────────────────────────────────

/**
 * Compact artifacts whose content exceeds `threshold`.
 * Small artifacts pass through unchanged.
 *
 * When an artifact is compacted the result carries `wasCompacted=true` plus
 * `originalChars` / `compactedChars` so prompt templates can render a
 * `· compacted` marker + `read_file` access hint and downstream code can
 * compute aggregate compaction stats. The metadata fields are optional on
 * `ResolvedArtifact`, so artifacts that pass through unchanged remain
 * structurally identical to the input.
 */
export function compactArtifacts(
  artifacts: ResolvedArtifact[],
  config: ArtifactCompactionConfig,
): ResolvedArtifact[] {
  const { threshold, toolHint = 'read_file' } = config;
  return artifacts.map(a => {
    if (!a.content || a.content.length <= threshold) return a;
    const result = compactContent(a.content, {
      threshold,
      label: a.label || a.path,
      filePath: a.path,
      toolHint,
    });
    return {
      ...a,
      content: result.content,
      wasCompacted: result.wasCompacted,
      originalChars: result.originalChars,
      compactedChars: result.compactedChars,
    };
  });
}

// ────────────────────────────────────────────────────────────────
// Convenience: select + compact
// ────────────────────────────────────────────────────────────────

export function resolveArtifacts(
  candidates: ResolvedArtifact[],
  policy: ArtifactSelectionPolicy,
  compaction?: ArtifactCompactionConfig,
): ResolvedArtifact[] {
  const selected = selectArtifacts(candidates, policy);
  if (!compaction) return selected;
  return compactArtifacts(selected, compaction);
}

// ────────────────────────────────────────────────────────────────
// ArtifactPoolView — centralized typed access to the artifact pool
// ────────────────────────────────────────────────────────────────

/**
 * Typed read-only view over a flat ResolvedArtifact[] pool.
 *
 * All path matching is centralized here so that node-level code
 * never hard-codes artifact path prefixes.
 */
export class ArtifactPoolView {
  constructor(private readonly pool: ResolvedArtifact[]) {}

  /** Raw pool (for pipeline functions that need the array). */
  get all(): ResolvedArtifact[] { return this.pool; }
  get length(): number { return this.pool.length; }

  // ── Category filters ──

  get systemDesigns(): ResolvedArtifact[] {
    return this.pool.filter(a => a.path.startsWith(ARTIFACT_PREFIX.SYSTEM_DESIGN));
  }

  get specs(): ResolvedArtifact[] {
    return this.pool.filter(a => a.path.startsWith(ARTIFACT_PREFIX.SPEC));
  }

  get ui(): ResolvedArtifact[] {
    return this.pool.filter(a => isUiArtifactPath(a.path));
  }

  get gameArt(): ResolvedArtifact[] {
    return this.pool.filter(a => isGameArtArtifactPath(a.path));
  }

  get sources(): ResolvedArtifact[] {
    return this.pool.filter(a => a.path.startsWith(ARTIFACT_PREFIX.SOURCES));
  }

  get apiContracts(): ResolvedArtifact[] {
    return this.pool.filter(a => a.path.startsWith(ARTIFACT_PREFIX.API_CONTRACT));
  }

  // ── Gate presence checks — SSOT for post-RAC template Gate flags ──
  //
  // Role-agnostic: returns true for BOTH `role='ref'` AND `role='context'`.
  // Post-RAC templates choose these for any block that fires identically
  // regardless of role (task decomposition, inventory guides, visual
  // source hints). See the file-level "Post-RAC template flag
  // categories" docblock and `.cursorrules`
  // "Post-RAC Template Condition SSOT".

  hasSystemDesign(): boolean { return this.pool.some(a => a.path.startsWith(ARTIFACT_PREFIX.SYSTEM_DESIGN)); }
  hasSpec(): boolean         { return this.pool.some(a => a.path.startsWith(ARTIFACT_PREFIX.SPEC)); }
  hasUi(): boolean           { return this.pool.some(a => isUiArtifactPath(a.path)); }
  hasGameArt(): boolean      { return this.pool.some(a => isGameArtArtifactPath(a.path)); }
  hasSources(): boolean      { return this.pool.some(a => a.path.startsWith(ARTIFACT_PREFIX.SOURCES)); }

  // ── Role-scoped checks — Contract (ref) / Background (context) ──

  hasSystemDesignRef(): boolean {
    return this.pool.some(a => a.role === 'ref' && a.path.startsWith(ARTIFACT_PREFIX.SYSTEM_DESIGN));
  }
  hasSystemDesignContext(): boolean {
    return this.pool.some(a => a.role === 'context' && a.path.startsWith(ARTIFACT_PREFIX.SYSTEM_DESIGN));
  }

  hasSpecRef(): boolean {
    return this.pool.some(a => a.role === 'ref' && a.path.startsWith(ARTIFACT_PREFIX.SPEC));
  }
  hasSpecContext(): boolean {
    return this.pool.some(a => a.role === 'context' && a.path.startsWith(ARTIFACT_PREFIX.SPEC));
  }

  hasUiRef(): boolean {
    return this.pool.some(a => a.role === 'ref' && isUiArtifactPath(a.path));
  }
  hasUiContext(): boolean {
    return this.pool.some(a => a.role === 'context' && isUiArtifactPath(a.path));
  }

  hasGameArtRef(): boolean {
    return this.pool.some(a => a.role === 'ref' && isGameArtArtifactPath(a.path));
  }
  hasGameArtContext(): boolean {
    return this.pool.some(a => a.role === 'context' && isGameArtArtifactPath(a.path));
  }

  /**
   * Aggregate "any design ref present" — true when any of the four design
   * artifact kinds (system-design / spec / ui / game-art) is present in
   * the pool with `role='ref'`.
   *
   * SSOT for "the user / intent supplied a design reference document for
   * this turn". When this returns true, decompose's executionTier is
   * structurally pinned to Tier 4 for `generate`/`refactor` modes — the
   * presence of a design ref means the work is multi-boundary and must be
   * faithfully decomposed against the document, never collapsed by
   * single-task heuristics. Enforced at runtime by
   * `validateExecutionTier` in `core/executionTier`.
   *
   * Mirrors the role assignments in `@ant/shared/action-config-matrix.ts`:
   * the four design kinds are exactly the slots that the matrix marks as
   * `refs:` for any `gen-code-*` / `rev-code` intent.
   */
  hasAnyDesignRef(): boolean {
    return this.hasSystemDesignRef()
      || this.hasSpecRef()
      || this.hasUiRef()
      || this.hasGameArtRef();
  }

  /**
   * Discriminate which `UiSource` this pool carries. Exactly one or none; a
   * pool containing artifacts from two UI sources is an invariant violation
   * caused by slot-merging bugs and throws so the caller can bail early
   * rather than producing a confused prompt.
   *
   * `uiSource` is a Contract-flavoured flag (per-source branching in prompts)
   * and MUST be consumed by `ui-source-dispatch.md` to select the correct
   * interpretation partial. See .cursorrules "Post-RAC Template Condition
   * SSOT" — this flag is one of the documented exceptions to Gate-first.
   */
  uiSource(): UiSource | null {
    let found: UiSource | null = null;
    for (const a of this.pool) {
      const src = uiSourceOfPath(a.path);
      if (src === null) continue;
      if (found === null) {
        found = src;
      } else if (found !== src) {
        throw new Error(
          `ArtifactPoolView.uiSource: pool contains mixed UI sources (${found}, ${src}); ` +
          'hard-exclusive invariant violated at RAC resolution time.',
        );
      }
    }
    return found;
  }

  hasSourcesRef(): boolean {
    return this.pool.some(a => a.role === 'ref' && a.path.startsWith(ARTIFACT_PREFIX.SOURCES));
  }
  hasSourcesContext(): boolean {
    return this.pool.some(a => a.role === 'context' && a.path.startsWith(ARTIFACT_PREFIX.SOURCES));
  }

  // ── Aggregate metrics ──

  systemDesignSize(): number {
    return this.systemDesigns.reduce((s, a) => s + (a.content?.length || 0), 0);
  }

  // ── Name↔content maps ──

  /**
   * Flat name→content map from system-design artifacts.
   * Strips prefix + `.md` suffix.
   * e.g. `architecture/system/fe-system-main.md` → `fe-system-main`
   */
  flattenSystemDesigns(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const a of this.pool) {
      if (!a.path.startsWith(ARTIFACT_PREFIX.SYSTEM_DESIGN) || !a.content) continue;
      const name = a.path.slice(ARTIFACT_PREFIX.SYSTEM_DESIGN.length).replace(/\.md$/, '');
      map[name] = a.content;
    }
    return map;
  }

  /**
   * Look up design document by package tag.
   * `fe-{name}` → `fe-system-{name}.md`, `be-{name}` → `be-system-{name}.md`.
   */
  getDesignDocByPackage(pkg: string): string | undefined {
    let prefix: string;
    if (pkg.startsWith('fe-')) {
      prefix = `${ARTIFACT_PREFIX.FE_SYSTEM}${pkg.slice(3)}`;
    } else if (pkg.startsWith('be-')) {
      prefix = `${ARTIFACT_PREFIX.BE_SYSTEM}${pkg.slice(3)}`;
    } else {
      return undefined;
    }
    return this.pool.find(a => a.path === prefix || a.path === `${prefix}.md`)?.content;
  }

  /** First system-design artifact content (for display/logging). */
  firstDesignContent(): string | undefined {
    return this.pool.find(a => a.path.startsWith(ARTIFACT_PREFIX.SYSTEM_DESIGN))?.content;
  }

  /** Combined source/prd content. */
  sourceContent(): string | undefined {
    return this.pool.find(a => a.path === ARTIFACT_PREFIX.SOURCES)?.content;
  }

  /** Source artifacts as Record<filename, content> (legacy compat). */
  sourcesAsRecord(): Record<string, string> {
    const map: Record<string, string> = {};
    const sourcesPrefix = `${ARTIFACT_PREFIX.SOURCES}/`;
    for (const a of this.sources) {
      const name = a.path.startsWith(sourcesPrefix)
        ? a.path.slice(sourcesPrefix.length)
        : a.path;
      if (a.content) map[name] = a.content;
    }
    return map;
  }

  /** Source filenames list. */
  sourceFileNames(): string[] {
    const sourcesPrefix = `${ARTIFACT_PREFIX.SOURCES}/`;
    return this.sources.map(a => {
      const p = a.path;
      return p.startsWith(sourcesPrefix) ? p.slice(sourcesPrefix.length) : p;
    });
  }

  /** Total character count across all source artifacts. */
  sourcesSize(): number {
    return this.sources.reduce((s, a) => s + (a.content?.length || 0), 0);
  }

  /**
   * Canonical plan-document content.
   *
   * Service domain emits `prd.md`, game domain emits `gdd.md`. Both are
   * canonical outputs of `gen-plan` and represent the same SSOT role —
   * the plan document for the workspace. This getter returns whichever
   * one is present in the pool, preferring `prd.md` when both exist
   * (legacy migration safety: a workspace that authored prd.md before
   * the gdd.md split keeps that file as authoritative).
   */
  prdContent(): string | undefined {
    const sourcesPrefix = `${ARTIFACT_PREFIX.SOURCES}/`;
    return (
      this.pool.find(a => a.path === `${sourcesPrefix}prd.md`)?.content ??
      this.pool.find(a => a.path === `${sourcesPrefix}gdd.md`)?.content
    );
  }

  /** Find a spec artifact by filename (e.g. `spec-login.md`). */
  findSpec(filename: string): ResolvedArtifact | undefined {
    return this.pool.find(a => a.path === `${ARTIFACT_PREFIX.SPEC}${filename}`);
  }

  /**
   * Filename of the spec selected as a development source for this turn.
   *
   * SSOT for "is this job spec-driven?": a spec with `role='ref'` in the
   * RAC-derived artifact pool means the user/intent explicitly promoted it
   * to a development source (e.g. `gen-code-spec` intent with
   * `refsSingleSelect: true`, or `rev-code` with a spec mention).
   *
   * Returns `null` when no spec is in the ref role — `role='context'` specs
   * do NOT count (they are reference material only).
   *
   * Replaces the legacy `<selectedSpec>` LLM tag + `state.selectedSpec`
   * field. The decompose LLM must NOT re-pick a spec mid-turn; the choice
   * is made upstream at intent/action-metadata time.
   */
  activeSpecRefFilename(): string | null {
    const ref = this.pool.find(a =>
      a.role === 'ref' && a.path.startsWith(ARTIFACT_PREFIX.SPEC)
    );
    if (!ref) return null;
    return ref.path.slice(ARTIFACT_PREFIX.SPEC.length);
  }
}

// ── Backward-compatible free functions (delegate to ArtifactPoolView) ──

export function flattenDesignArtifacts(artifacts: ResolvedArtifact[]): Record<string, string> {
  return new ArtifactPoolView(artifacts).flattenSystemDesigns();
}

export function getDesignDocByPackageFromPool(pkg: string, artifacts: ResolvedArtifact[]): string | undefined {
  return new ArtifactPoolView(artifacts).getDesignDocByPackage(pkg);
}

// ────────────────────────────────────────────────────────────────
// Design Job Pool Utilities (Phase 3: cross-job unification)
// ────────────────────────────────────────────────────────────────

/**
 * Strip feature-path prefix from a project-root-relative path.
 * e.g. 'features/proj/feat/visual/ui/ant/ui-tokens.json' → 'visual/ui/ant/ui-tokens.json'
 */
export function toFeatureRelative(filePath: string, featurePath: string): string {
  const featurePrefix = featurePath.replace(/^\//, '').replace(/\/?$/, '/');
  if (filePath.startsWith(featurePrefix)) return filePath.slice(featurePrefix.length);
  return filePath;
}

/**
 * Upsert artifacts into pool by path (same path → latest content wins).
 */
export function appendOrUpdatePool(
  pool: ResolvedArtifact[],
  newArtifacts: ResolvedArtifact[],
): ResolvedArtifact[] {
  const map = new Map(pool.map(a => [a.path, a]));
  for (const a of newArtifacts) {
    const existing = map.get(a.path);
    if (existing && existing.role !== a.role) {
      console.warn(
        `⚠️ [ArtifactPool] Role conflict on "${a.path}": ` +
        `existing=${existing.role} -> new=${a.role}. Keeping new.`
      );
    }
    map.set(a.path, a);
  }
  return Array.from(map.values());
}

// `scanDesignOutputs` and `buildDesignArtifactPool` were removed in the
// state.artifacts post-RAC SSOT refactor. The pool is now exclusively
// populated by `loadResolvedArtifacts(resolvedAction, featurePath)`
// (single writer, RAC-bounded) plus `appendOrUpdatePool(pool, task.files)`
// for design's intra-job self-output. See `.cursorrules`
// "state.artifacts Post-RAC SSOT".
