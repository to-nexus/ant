/**
 * buildDecomposeContext — Role-aware artifact partition for decompose prompts.
 *
 * Replaces the per-node ad-hoc string concatenation (`spec` /
 * `uiContext` / `directiveContext`) that flattened the role-based
 * artifact pool into a single inline string and discarded the
 * `role='ref' | 'context'` provenance assigned upstream by
 * `loadResolvedArtifacts`.
 *
 * Pipeline alignment:
 *   - explicit pipeline: RAC.refs / RAC.context come straight from
 *     ActionMetadata, so the pool already mirrors the user's exact
 *     refs/context selection.
 *   - infer pipeline: `mergeWithMetadata` dedup-additive merges
 *     `inferred(intent matrix path-default + LLM)` with
 *     `metadata` before the pool is loaded.
 *   - This helper preserves the role each artifact arrived with so the
 *     decompose template surfaces them in role-segregated blocks.
 *
 * The output is consumed by
 * `jobs/design/nodes/decompose/shared/input-context.md`, which renders
 * one `<sources role="…">` / `<previous-design role="…">` /
 * `<artifact role="…">` block per partition.
 */

import type { ResolvedArtifact, Domain } from '@ant/shared';
import { ARTIFACT_PREFIX, getEffectiveDomain } from '@ant/shared';
import {
  buildAllSourceDocs,
  buildSourceFileIndex,
} from '../../../../../../core/utils/sourceDocuments';
import { isUiArtifactPath } from '../../../../../../core/artifact/ArtifactPipeline';
import type { ArtifactPoolView } from '../../../../../../core/artifact/ArtifactPipeline';

export type SourcesMode = 'inline' | 'tool';

export interface SourcesBlock {
  /** `inline` = concatenated content; `tool` = file index for `read_source_doc`. */
  mode: SourcesMode;
  body: string;
  /** When true, render the read_source_doc hint below the body. */
  toolHint?: boolean;
}

export interface OtherArtifact {
  path: string;
  content: string;
}

export interface RoleBucket {
  /** sources/* artifacts, optionally compacted into a tool-mode index. */
  sources?: SourcesBlock;
  /** First system-design artifact content for this role (if any). */
  previousDesign?: string;
  /** Any other ref/context artifact (spec / api-contract / ui-* / arbitrary path). */
  other?: OtherArtifact[];
}

export interface BuildDecomposeContextOptions {
  /**
   * Whether to surface system-design artifacts as `previousDesign`.
   * Currently only `systemDesignDecompose` enables this — the other
   * decompose nodes ignore previous system designs.
   */
  includePreviousDesign?: boolean;
  /**
   * Total ref+context content size threshold above which `sources/*`
   * is rendered in tool-mode (file index + read_source_doc tool).
   * Other artifact categories remain inline regardless because they
   * are typically the user's explicit additions and dropping them
   * would defeat the explicit/additive guarantees.
   */
  toolModeThreshold: number;
}

export interface DecomposeContext {
  /** "PRD" for service domain, "GDD" for game domain. Drives partial copy. */
  documentName: 'PRD' | 'GDD';
  refs: RoleBucket;
  context: RoleBucket;
  /** state.directive — a free-form user directive. Not an artifact. */
  directive?: string;
  /** Render-only telemetry. */
  meta: {
    poolSize: number;
    refSize: number;
    contextSize: number;
    sourcesMode: SourcesMode;
  };
}

interface State {
  resolvedAction?: { domain?: Domain };
  directive?: string;
}

function isSourcesPath(p: string): boolean {
  return p.startsWith(ARTIFACT_PREFIX.SOURCES);
}

function isSystemDesignPath(p: string): boolean {
  return p.startsWith(ARTIFACT_PREFIX.SYSTEM_DESIGN);
}

function totalContentSize(artifacts: ResolvedArtifact[]): number {
  return artifacts.reduce((s, a) => s + (a.content?.length || 0), 0);
}

function sourcesAsRecord(artifacts: ResolvedArtifact[]): Record<string, string> {
  const map: Record<string, string> = {};
  const planPrefix = `${ARTIFACT_PREFIX.SOURCES}/`;
  for (const a of artifacts) {
    if (!a.content) continue;
    const name = a.path.startsWith(planPrefix)
      ? a.path.slice(planPrefix.length)
      : a.path;
    map[name] = a.content;
  }
  return map;
}

function buildSourcesBlock(
  artifacts: ResolvedArtifact[],
  useToolMode: boolean,
): SourcesBlock | undefined {
  if (artifacts.length === 0) return undefined;
  const record = sourcesAsRecord(artifacts);
  if (Object.keys(record).length === 0) return undefined;
  if (useToolMode) {
    return {
      mode: 'tool',
      body: buildSourceFileIndex(record),
      toolHint: true,
    };
  }
  return {
    mode: 'inline',
    body: buildAllSourceDocs(record),
  };
}

function pickFirstContent(artifacts: ResolvedArtifact[]): string | undefined {
  for (const a of artifacts) {
    if (a.content) return a.content;
  }
  return undefined;
}

/**
 * Build a role-aware decompose context from an artifact pool.
 *
 * Partition rules:
 *   1. Split the pool by `role` ('ref' vs 'context').
 *   2. Within each role, classify by path prefix:
 *      - `plan/...` → `RoleBucket.sources`
 *      - `architecture/system/...` → `RoleBucket.previousDesign`
 *        (only when `includePreviousDesign` is true; otherwise falls
 *        through to `other`)
 *      - everything else → `RoleBucket.other` (preserves path)
 *   3. Tool-mode toggle considers the *total* size across ref+context
 *      so a large explicit/additive ref doesn't get silently inlined.
 *      Only `sources/*` swaps to tool-mode; other categories stay
 *      inline so explicit/additive injections aren't dropped.
 */
export function buildDecomposeContext(
  pool: ArtifactPoolView,
  state: State,
  options: BuildDecomposeContextOptions,
): DecomposeContext {
  const all = pool.all;
  const refs = all.filter(a => a.role === 'ref');
  const ctx = all.filter(a => a.role === 'context');

  const refSize = totalContentSize(refs);
  const contextSize = totalContentSize(ctx);
  const useToolMode = refSize + contextSize > options.toolModeThreshold;

  const refSources = refs.filter(a => isSourcesPath(a.path));
  const ctxSources = ctx.filter(a => isSourcesPath(a.path));

  const refDesigns = options.includePreviousDesign
    ? refs.filter(a => isSystemDesignPath(a.path))
    : [];
  const ctxDesigns = options.includePreviousDesign
    ? ctx.filter(a => isSystemDesignPath(a.path))
    : [];

  const refOther = refs.filter(
    a =>
      !isSourcesPath(a.path) &&
      !(options.includePreviousDesign && isSystemDesignPath(a.path)),
  );
  const ctxOther = ctx.filter(
    a =>
      !isSourcesPath(a.path) &&
      !(options.includePreviousDesign && isSystemDesignPath(a.path)),
  );

  const documentName: 'PRD' | 'GDD' =
    getEffectiveDomain(state.resolvedAction?.domain) === 'game' ? 'GDD' : 'PRD';

  const refBucket: RoleBucket = {
    sources: buildSourcesBlock(refSources, useToolMode),
    previousDesign: pickFirstContent(refDesigns),
    other: refOther
      .filter(a => a.content)
      .map(a => ({ path: a.path, content: a.content })),
  };
  const ctxBucket: RoleBucket = {
    sources: buildSourcesBlock(ctxSources, useToolMode),
    previousDesign: pickFirstContent(ctxDesigns),
    other: ctxOther
      .filter(a => a.content)
      .map(a => ({ path: a.path, content: a.content })),
  };

  // Drop empty arrays so {{#each}} blocks render nothing instead of
  // emitting a stray separator line.
  if (refBucket.other && refBucket.other.length === 0) refBucket.other = undefined;
  if (ctxBucket.other && ctxBucket.other.length === 0) ctxBucket.other = undefined;

  return {
    documentName,
    refs: refBucket,
    context: ctxBucket,
    directive: state.directive,
    meta: {
      poolSize: all.length,
      refSize,
      contextSize,
      sourcesMode: useToolMode ? 'tool' : 'inline',
    },
  };
}

/**
 * Re-export `isUiArtifactPath` so call sites can disambiguate ui-source
 * artifacts when they need finer-grained classification beyond the
 * sources / previous-design / other split this helper provides.
 */
export { isUiArtifactPath };
