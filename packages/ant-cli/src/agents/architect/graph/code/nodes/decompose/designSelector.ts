/**
 * RAC Injection Preparation for Code Decompose
 *
 * Single entry point — `prepareRacInjection(state, modelContextLimitTokens)` —
 * produces every artifact-derived template variable that the decompose
 * prompt needs:
 *
 *   - `refs` / `context`              — all role-scoped artifacts (system-design
 *                                       included), each carrying `wasCompacted`
 *                                       metadata so prompt branches can render
 *                                       a `· compacted` marker + `read_file`
 *                                       access hint. These power the broad
 *                                       audit views; templates today consume
 *                                       the narrower `*Artifacts` lists below.
 *   - `refArtifacts` / `contextArtifacts`
 *                                     — generic artifacts only (system-design,
 *                                       spec, ui prefixes filtered out — those
 *                                       have decompose-specific handling
 *                                       elsewhere). Drives the
 *                                       `## Provided Documents` section in
 *                                       `base.md`.
 *   - `documents` / `hasDocuments`    — system-design artifacts only. Drives
 *                                       the `design-doc-guide` partial which
 *                                       carries MSA / Repo guidance plus
 *                                       inlined system-design content.
 *   - `hasCompactedArtifacts`         — any ref or context artifact carries
 *                                       `wasCompacted=true`. Templates use it
 *                                       to gate the "Compacted Documents —
 *                                       Reading Strategy" guidance in
 *                                       `rules.md`.
 *   - `meta`                          — observation payload for logging
 *                                       (grand totals, demoted paths, budget).
 *
 * Compaction policy:
 *   1. Each artifact flows through `compactArtifacts` with a role-scoped
 *      threshold (refs preserve more — they ground task enumeration —
 *      context outlines earlier).
 *   2. When the post-pass grand total still exceeds the model-derived
 *      char budget, contexts demote to threshold 0 first (fully outlined),
 *      then the largest still-inline refs are demoted greedily until the
 *      total fits or every artifact is already an outline.
 *
 * No artifact content is ever truncated — compacted documents become
 * line-numbered outlines that the LLM can re-expand on demand via
 * `read_file(path, startLine, endLine)`.
 */

import type { ArchitectGraphState } from "../../state";
import type { ResolvedArtifact } from "@ant/shared";
import { ARTIFACT_PREFIX } from "@ant/shared";
import {
  ArtifactPoolView,
  compactArtifacts,
} from "../../../../../../core/prompt/builder/ArtifactPipeline";
import { compactContent } from "../../../../../../core/utils/contentCompactor";
import {
  REF_INLINE_THRESHOLD_CHARS,
  CONTEXT_INLINE_THRESHOLD_CHARS,
  SAFETY_MARGIN_TOKENS,
  OUTPUT_RESERVE_TOKENS,
  THINKING_RESERVE_TOKENS,
  TOOL_DEF_RESERVE_TOKENS,
  TOOL_RESULT_RESERVE_TOKENS,
  SYSTEM_PROMPT_RESERVE_TOKENS,
  WORST_CASE_CHARS_PER_TOKEN,
  FALLBACK_MODEL_CONTEXT_LIMIT_TOKENS,
} from "../../../../../../core/context/constants";

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

export interface RacInjectionMeta {
  /** Sum of original artifact content chars (refs + context). */
  grandTotalCharsBefore: number;
  /** Sum of post-compaction artifact content chars. */
  grandTotalCharsAfter: number;
  /** Computed char budget for refs+context combined. */
  artifactBudgetChars: number;
  /** Number of refs whose content was replaced with an outline. */
  refsCompactedCount: number;
  /** Number of contexts whose content was replaced with an outline. */
  contextCompactedCount: number;
  /** Paths of artifacts demoted to threshold=0 by dynamic budget pressure. */
  forcedZeroThresholdPaths: string[];
  /** True when the model context window came from the fallback constant. */
  usedFallbackModelContextLimit: boolean;
}

export interface RacInjection {
  /** Every ref artifact (system-design included), post-compaction. */
  refs: ResolvedArtifact[];
  /** Every context artifact (system-design included), post-compaction. */
  context: ResolvedArtifact[];
  /**
   * Generic refs — system-design / spec / ui prefixes excluded so the
   * `## Provided Documents` block in `base.md` does not duplicate the
   * specialized partials' content.
   */
  refArtifacts: ResolvedArtifact[];
  /** Generic context — see `refArtifacts` above. */
  contextArtifacts: ResolvedArtifact[];
  /** System-design artifacts only — drives `design-doc-guide` partial. */
  documents: ResolvedArtifact[];
  hasDocuments: boolean;
  hasGenericArtifacts: boolean;
  /** True when any ref/context artifact was compacted. */
  hasCompactedArtifacts: boolean;
  meta: RacInjectionMeta;
}

// ────────────────────────────────────────────────────────────────
// Char budget derivation
// ────────────────────────────────────────────────────────────────

/**
 * Translate a model context window (in tokens) into a char budget for
 * artifact content. Subtracts every fixed-size reservation (output,
 * thinking, tool defs, tool results, system prompt, safety margin) plus
 * a small allowance for non-artifact channels (codebase file paths,
 * tier refs, runtime asset index), then converts at the worst-case
 * char-to-token ratio.
 */
function computeArtifactBudgetChars(modelContextLimitTokens: number): number {
  const inputBudgetTokens =
    modelContextLimitTokens
    - OUTPUT_RESERVE_TOKENS
    - THINKING_RESERVE_TOKENS
    - TOOL_DEF_RESERVE_TOKENS
    - TOOL_RESULT_RESERVE_TOKENS
    - SYSTEM_PROMPT_RESERVE_TOKENS
    - SAFETY_MARGIN_TOKENS;
  // Reserve ~8K tokens for codebaseFilePaths / tierRefs / runtimeAssets
  const artifactBudgetTokens = Math.max(0, inputBudgetTokens - 8_000);
  return Math.floor(artifactBudgetTokens * WORST_CASE_CHARS_PER_TOKEN);
}

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

/**
 * Path-prefix exclusions for the `## Provided Documents` section in
 * `base.md` — these artifact kinds have decompose-specific handling
 * (system-design via `design-doc-guide`, spec via `<selectedSpec>` /
 * tier rules, UI via the dedicated UI sections + `ui-source-dispatch`)
 * so injecting them again as generic refs/context would duplicate the
 * content. Mirrors the legacy `[AP.SYSTEM_DESIGN, AP.SPEC, AP.UI]`
 * filter in `index.ts` byte-for-byte (UI = `visual/ui/` covers all
 * three UiSource subdirectories).
 */
const SPECIAL_PREFIXES_FOR_GENERIC = [
  ARTIFACT_PREFIX.SYSTEM_DESIGN,
  ARTIFACT_PREFIX.SPEC,
  ARTIFACT_PREFIX.UI,
];

function isSpecialForGeneric(a: ResolvedArtifact): boolean {
  return SPECIAL_PREFIXES_FOR_GENERIC.some(p => a.path.startsWith(p));
}

function sumContentChars(arr: ResolvedArtifact[]): number {
  return arr.reduce((s, a) => s + (a.content?.length || 0), 0);
}

function labelForSystemDesign(path: string): string {
  const name = path.slice(ARTIFACT_PREFIX.SYSTEM_DESIGN.length).replace(/\.md$/, '');
  if (name.startsWith('fe-system-')) return `Frontend System Design: ${name.replace('fe-system-', '')}`;
  if (name.startsWith('be-system-')) return `Backend System Design: ${name.replace('be-system-', '')}`;
  if (name.startsWith('api-contract-')) return `API Contract: ${name.replace('api-contract-', '')}`;
  return name;
}

/**
 * Force a single artifact through `compactContent` with `threshold=0`
 * regardless of size. Used by the dynamic-demotion path when the grand
 * total still exceeds the artifact budget after the role-specific pass.
 */
function forceCompact(a: ResolvedArtifact): ResolvedArtifact {
  if (!a.content || a.wasCompacted) return a;
  const result = compactContent(a.content, {
    threshold: 0,
    label: a.label || a.path,
    filePath: a.path,
    toolHint: 'read_file',
  });
  return {
    ...a,
    content: result.content,
    wasCompacted: result.wasCompacted,
    originalChars: result.originalChars,
    compactedChars: result.compactedChars,
  };
}

// ────────────────────────────────────────────────────────────────
// Main entry
// ────────────────────────────────────────────────────────────────

/**
 * Build the artifact-derived template variables for the code decompose
 * prompt. See file-level comment for the policy and output contract.
 */
export function prepareRacInjection(
  state: ArchitectGraphState,
  modelContextLimitTokens?: number,
): RacInjection {
  const pool = new ArtifactPoolView(state.artifacts || []);
  const allWithContent = pool.all.filter(a => a.content?.trim());

  const refsBefore = allWithContent.filter(a => a.role === 'ref');
  const contextBefore = allWithContent.filter(a => a.role === 'context');
  const grandTotalCharsBefore =
    sumContentChars(refsBefore) + sumContentChars(contextBefore);

  // Step 1 — role-specific thresholds. Refs preserve more (development
  // source); context outlines earlier (supplementary material).
  let refs = compactArtifacts(refsBefore, {
    threshold: REF_INLINE_THRESHOLD_CHARS,
    toolHint: 'read_file',
  });
  let context = compactArtifacts(contextBefore, {
    threshold: CONTEXT_INLINE_THRESHOLD_CHARS,
    toolHint: 'read_file',
  });

  // Step 2 — grand-total budget check. When the role-pass result still
  // exceeds the model-derived char budget, demote progressively:
  //   2a. Force every still-inline context to threshold=0.
  //   2b. Greedy-demote the largest still-inline ref until under budget
  //       OR everything is already an outline.
  const usedFallbackModelContextLimit = modelContextLimitTokens === undefined;
  const ctxLimit = modelContextLimitTokens ?? FALLBACK_MODEL_CONTEXT_LIMIT_TOKENS;
  const artifactBudgetChars = computeArtifactBudgetChars(ctxLimit);
  const forcedZeroThresholdPaths: string[] = [];

  let total = sumContentChars(refs) + sumContentChars(context);

  if (total > artifactBudgetChars) {
    // 2a — context demotion
    let contextChanged = false;
    context = context.map(a => {
      if (a.wasCompacted) return a;
      if (!a.content || a.content.length === 0) return a;
      const forced = forceCompact(a);
      if (forced !== a) {
        forcedZeroThresholdPaths.push(a.path);
        contextChanged = true;
      }
      return forced;
    });
    if (contextChanged) {
      total = sumContentChars(refs) + sumContentChars(context);
    }

    // 2b — greedy ref demotion
    while (total > artifactBudgetChars) {
      let largestInline: ResolvedArtifact | undefined;
      for (const a of refs) {
        if (a.wasCompacted) continue;
        if (!a.content) continue;
        if (!largestInline || a.content.length > (largestInline.content?.length || 0)) {
          largestInline = a;
        }
      }
      if (!largestInline) break;
      const forced = forceCompact(largestInline);
      refs = refs.map(a => (a.path === largestInline!.path ? forced : a));
      forcedZeroThresholdPaths.push(largestInline.path);
      total = sumContentChars(refs) + sumContentChars(context);
    }

    if (total > artifactBudgetChars) {
      console.warn(
        `⚠️  [DesignSelector] Grand-total still exceeds artifact budget after demotion: ` +
        `${total.toLocaleString()} chars > ${artifactBudgetChars.toLocaleString()} chars budget. ` +
        `Proceeding — every artifact has already been outlined.`,
      );
    }
  }

  // Assemble — system-design surface for design-doc-guide partial. The
  // partial expects readable labels (e.g. "Frontend System Design: main")
  // so we restore the label here. The same underlying ResolvedArtifact
  // objects (post-compaction) participate in `refs` / `context` too.
  const documents = [...refs, ...context]
    .filter(a => a.path.startsWith(ARTIFACT_PREFIX.SYSTEM_DESIGN))
    .map(a => ({ ...a, label: labelForSystemDesign(a.path) }));

  const refArtifacts = refs.filter(a => !isSpecialForGeneric(a));
  const contextArtifacts = context.filter(a => !isSpecialForGeneric(a));
  const hasGenericArtifacts = refArtifacts.length > 0 || contextArtifacts.length > 0;
  const hasCompactedArtifacts =
    refs.some(a => a.wasCompacted) || context.some(a => a.wasCompacted);

  const grandTotalCharsAfter =
    sumContentChars(refs) + sumContentChars(context);
  const refsCompactedCount = refs.filter(a => a.wasCompacted).length;
  const contextCompactedCount = context.filter(a => a.wasCompacted).length;

  if (hasCompactedArtifacts || forcedZeroThresholdPaths.length > 0) {
    console.log(
      `📦 [DesignSelector] RAC injection: ` +
      `refs ${refs.length} (compacted ${refsCompactedCount}), ` +
      `context ${context.length} (compacted ${contextCompactedCount}), ` +
      `total ${grandTotalCharsBefore.toLocaleString()} → ${grandTotalCharsAfter.toLocaleString()} chars ` +
      `(budget ${artifactBudgetChars.toLocaleString()}, forced-zero=${forcedZeroThresholdPaths.length})`,
    );
  }

  return {
    refs,
    context,
    refArtifacts,
    contextArtifacts,
    documents,
    hasDocuments: documents.length > 0,
    hasGenericArtifacts,
    hasCompactedArtifacts,
    meta: {
      grandTotalCharsBefore,
      grandTotalCharsAfter,
      artifactBudgetChars,
      refsCompactedCount,
      contextCompactedCount,
      forcedZeroThresholdPaths,
      usedFallbackModelContextLimit,
    },
  };
}
