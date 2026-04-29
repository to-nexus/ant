import { TASK_PRIORITIES } from "../../state";
import { TaskQueue } from "../../../../types/task";
import { CodeTask } from "../../../../types/task";
import { extractErrorDetails, createErrorViolation } from "../_common/errorHandler";
import { normalizeLanguage, normalizeFramework } from "../../../../../../utils/languageUtils";
import { ARTIFACT_PREFIX, BOUNDARY, type Boundary, type ExecutionTierId, type SpecClarify, type UiSource } from '@ant/shared';
import { parseExecutionTierTag } from '../../../../../../core/executionTier';
import { hooksForTaskType } from '../../tasks/_shared/registry';
import { DEFAULT_TASK_TYPE } from '../../tasks/_shared/types';
import { isVerificationTask } from '../../tasks/verification';
import { isFeatureTask } from '../../tasks/feature';
import { isUiTask } from '../../tasks/ui/model/is';
import { isDesignSystemTask } from '../../tasks/design-system/model/is';
import {
  prepareTagJson,
  extractFirstJsonObject,
} from '../../../../../../core/utils/llmResponseParser';

import type { PackageTierEntry, TaskType, GameEngine } from '@ant/shared';
import { SUPPORTED_GAME_ENGINES } from '@ant/shared';
import { flattenPolicyToInclude } from '../../../../../../core/artifact/ArtifactPipeline';

type ArtifactPolicy = { refs?: string[]; context?: string[] };

/**
 * Pipeline mode discriminator for `deriveArtifactPolicy`.
 *
 *   - `'infer'`   — RAC was inferred (no explicit user selection). The LLM's
 *                   `packages` tag is the canonical signal for which design
 *                   docs to inject; package → `fe-system-X.md` mapping is
 *                   active.
 *   - `'explicit'` — RAC was pinned by the user (`source: 'explicit'` AND
 *                   non-empty `refs ∪ context`). The user-selected files
 *                   are the sole authority; package-based ref synthesis
 *                   is suppressed. `packages` survives only as a tech-tier
 *                   hint consumed by `resolveTaskTechTiersFromMap`.
 *
 * Channel B closure for the `state.artifacts Post-RAC SSOT` (see
 * `.cursorrules` and the `mossy-nearing-gleam` regression). Without
 * suppression, a directive job whose RAC excluded `fe-system-main.md`
 * still ended up with that path baked into every `task.artifactPolicy.refs`
 * and `task.include`, which downstream phases then re-fetched from disk.
 */
export type ArtifactPolicyMode = 'infer' | 'explicit';

/**
 * Derive role-annotated artifact selection policy from legacy task fields.
 * Returns undefined for verification tasks (no docs needed).
 *
 * `activeSpecRefFilename` is the filename of the spec promoted to a
 * development source by the RAC (see `ArtifactPoolView.activeSpecRefFilename`).
 * The decompose LLM does NOT select specs anymore — the choice is fixed
 * upstream by intent + action metadata.
 *
 * `uiSource` selects the interpretation branch for ui/design-system tasks:
 *   - 'ant'     → honour `uiSections` to build a narrow subset of the canonical
 *                 ui-tokens/assets/spec JSON pool.
 *   - 'figma'   → ignore `uiSections`; inject the figma.json reference and
 *                 defer real data to live MCP exploration at execute time.
 *   - 'handoff' → ignore `uiSections` (handoff has no schema); select the
 *                 handoff directory via wildcard. `loadResolvedArtifacts`
 *                 replaces each file's content with a STUB (path + size +
 *                 kind + read_file hint) so the bundle behaves like source
 *                 code: execute/plan read files on demand rather than
 *                 receiving the whole bundle inline.
 * When undefined, fall back to 'ant' semantics for backward compatibility.
 *
 * `mode` — see `ArtifactPolicyMode`. Explicit pipelines suppress
 * package → `fe-system-X.md` ref synthesis. UI/design-system tasks keep
 * their `uiSections` branch in both modes because those paths are already
 * inside the RAC (the user explicitly selected the UI source slot when
 * the intent matrix exposed it).
 */
export function deriveArtifactPolicy(
  taskType: TaskType,
  packages?: string[],
  uiSections?: string[],
  activeSpecRefFilename?: string | null,
  uiSource?: UiSource,
  mode: ArtifactPolicyMode = 'infer',
): ArtifactPolicy | undefined {
  // R1 — phase layer is blind to `task.type`. The predicate helpers below
  // take a `{ type }` shape so this function (which owns only the type
  // string, not the full task object) can still dispatch through the
  // task-bundle SSOT.
  const taskShape = { type: taskType };
  if (isVerificationTask(taskShape)) return undefined;

  if (isUiTask(taskShape) || isDesignSystemTask(taskShape)) {
    const src: UiSource = uiSource ?? 'ant';
    if (src === 'figma') {
      return { context: [`${ARTIFACT_PREFIX.UI_FIGMA}figma.json`] };
    }
    if (src === 'handoff') {
      return { context: [`${ARTIFACT_PREFIX.UI_HANDOFF}*`] };
    }
    // src === 'ant'
    const contextPaths: string[] = [];
    if (uiSections?.length) {
      contextPaths.push(`${ARTIFACT_PREFIX.UI_ANT}tokens`);
      for (const sec of uiSections) {
        if (sec === 'tokens') continue;
        if (sec === 'assets') contextPaths.push(`${ARTIFACT_PREFIX.UI_ANT}assets`);
        else contextPaths.push(`${ARTIFACT_PREFIX.UI_ANT_SPEC}${sec}`);
      }
    } else {
      contextPaths.push(`${ARTIFACT_PREFIX.UI_ANT}*`);
    }
    return contextPaths.length > 0 ? { context: contextPaths } : undefined;
  }

  const refPaths: string[] = [];
  if (activeSpecRefFilename) refPaths.push(`${ARTIFACT_PREFIX.SPEC}${activeSpecRefFilename}`);

  // Channel B closure (`state.artifacts Post-RAC SSOT`): the
  // `packages → fe-system-X.md` mapping is the legacy infer-mode
  // mechanism for surfacing design docs to plan/execute. When the user
  // explicitly pinned the RAC, those paths must come from the user's
  // refs/context only — synthesizing them from `packages` reintroduces
  // the `prime-jetting-grate` / `mossy-nearing-gleam` leak even though
  // `state.artifacts` itself is RAC-bounded. `packages` is preserved on
  // the task for tech-tier resolution only.
  if (mode === 'infer' && packages?.length) {
    for (const pkg of packages) {
      if (pkg.startsWith('fe-')) refPaths.push(`${ARTIFACT_PREFIX.FE_SYSTEM}${pkg.slice(3)}.md`);
      else if (pkg.startsWith('be-')) refPaths.push(`${ARTIFACT_PREFIX.BE_SYSTEM}${pkg.slice(3)}.md`);
      else if (pkg === 'shared') refPaths.push(`${ARTIFACT_PREFIX.API_CONTRACT}*`);
    }
    if (!packages.includes('shared')) refPaths.push(`${ARTIFACT_PREFIX.API_CONTRACT}*`);
  }

  return refPaths.length > 0 ? { refs: refPaths } : undefined;
}

export interface ParsedTechTier {
  stack: string;
  stackReasoning: string;
  language: string;
  framework?: string | null;
  packageTiers?: Record<string, PackageTierEntry>;
  /**
   * Phase 1 — game-domain 5th slot. When the LLM emits `"gameEngine": "phaser"`
   * inside the `<techTier>` JSON, the parser surfaces it here so the
   * decompose node can apply it to `state.resolvedAction.basis.techTier.frontend.gameEngine`.
   */
  gameEngine?: GameEngine;
}

export interface ParsedDecomposeResponse {
  tasks: CodeTask[];
  referenceRequests?: Array<{project: string; branch?: string; reason?: string}>;
  techTier?: ParsedTechTier;
  boundary?: Boundary;
  /**
   * 5-tier execution strategy — LLM emits `<executionTier>N</executionTier>`.
   * `undefined` when the tag is missing; callers treat this as a prompt
   * violation and default to Tier 0 Reflex (safe read-only).
   */
  executionTier?: ExecutionTierId;
  /** Hints consumed by the `direct` node for Tier 0 / Tier 1 paths. */
  directHints?: { targetFiles?: string[]; explorationScope?: string };
  /** Design-redirect choice when task requires spec that is missing (see SpecClarify). */
  specClarify?: SpecClarify;
}

/**
 * Parse the body of a `<tasks>...</tasks>` block into an array of task
 * objects.
 *
 * Two contracts are supported:
 *
 *   1. **Per-task wrappers (current)** — `<task>{json}</task>` repeated
 *      inside `<tasks>`. Each `<task>` body is a single JSON object. This
 *      is the format the streaming pipeline can render task-by-task as
 *      each `</task>` arrives (see `XMLStreamParser.task_added`).
 *
 *   2. **Legacy JSON array (BC fallback)** — `<tasks>[ {...}, {...} ]</tasks>`.
 *      Older prompts and most existing test fixtures use this shape, and
 *      LLMs occasionally regress to it. We accept both so a contract
 *      drift never silently collapses to a 0-task no-op success.
 *
 * An empty `<tasks></tasks>` (or `<tasks>[]</tasks>`) maps to `[]`. The
 * caller validates `Array.isArray` so a malformed legacy body that
 * parses to a non-array is rejected with the canonical error message.
 */
function parseTasksBody(inner: string): unknown {
  const taskMatches = [...inner.matchAll(/<task>\s*([\s\S]*?)\s*<\/task>/g)];
  if (taskMatches.length > 0) {
    return taskMatches.map(m => JSON.parse(prepareTagJson(extractFirstJsonObject(m[1]))));
  }

  const trimmed = inner.trim();
  if (trimmed.length === 0 || trimmed === '[]') {
    return [];
  }

  // Legacy JSON-array contract.
  return JSON.parse(prepareTagJson(inner));
}

/**
 * Parse the JSON body of a single `<task>...</task>` element that the
 * streaming pipeline already isolated. Used by the decompose llmCaller's
 * `task_added` hook — partial broadcasts only need a minimal projection
 * (id / name / type / priority) so a malformed JSON throws here and the
 * caller swallows it (the final `parseLLMResponse` throws again at the
 * end of stream and the retry loop handles it).
 */
export function parseTaskItemJson(rawJson: string): unknown {
  return JSON.parse(prepareTagJson(extractFirstJsonObject(rawJson)));
}

/**
 * Parse LLM response and extract tasks
 * 
 * Expected format: 
 * <tasks>
 *   <task>{json}</task>
 *   <task>{json}</task>
 * </tasks>
 * <references>[...]</references>  (optional, can be empty array)
 * 
 * STRICT MODE: <tasks> wrapper is required. The body may use per-task
 * wrappers (current contract) or a legacy JSON array (BC fallback).
 */
export function parseLLMResponse(rawResponse: string): ParsedDecomposeResponse {
  try {
    // ✅ Extract <tasks> XML tag body (REQUIRED)
    const tasksMatch = rawResponse.match(/<tasks>\s*([\s\S]*?)\s*<\/tasks>/);
    
    if (!tasksMatch) {
      throw new Error('Invalid response: <tasks> tag is required. LLM must follow the prompt format strictly.');
    }
    
    const tasks = parseTasksBody(tasksMatch[1]);
    
    if (!Array.isArray(tasks)) {
      throw new Error('Invalid response: tasks must be an array');
    }
    
    // ✅ Extract techTier from <techTier> tag (stack + language + framework + packageTiers)
    let techTier: ParsedTechTier | undefined;
    const techTierMatch = rawResponse.match(/<techTier>\s*([\s\S]*?)\s*<\/techTier>/);
    
    if (techTierMatch) {
      try {
        const parsed = JSON.parse(prepareTagJson(techTierMatch[1]));
        const rawEngine = typeof parsed.gameEngine === 'string' ? parsed.gameEngine.toLowerCase() : undefined;
        const gameEngine = rawEngine && (SUPPORTED_GAME_ENGINES as readonly string[]).includes(rawEngine)
          ? (rawEngine as GameEngine)
          : undefined;
        techTier = {
          stack: parsed.stack || 'unknown',
          stackReasoning: parsed.stackReasoning || '',
          language: normalizeLanguage(parsed.language || 'typescript'),
          framework: normalizeFramework(parsed.framework || null),
          packageTiers: parsed.packageTiers || undefined,
          gameEngine,
        };
      } catch (error) {
        console.warn('⚠️  [Decompose] Failed to parse <techTier> tag content:', error);
        techTier = {
          stack: 'unknown',
          stackReasoning: 'Failed to parse techTier',
          language: 'typescript',
          framework: null,
        };
      }
    } else {
      console.warn('⚠️  [Decompose] No <techTier> tag found, using defaults');
      techTier = {
        stack: 'unknown',
        stackReasoning: 'No techTier tag in response',
        language: 'typescript',
        framework: null,
      };
    }

    // ✅ Extract references from <references> tag (OPTIONAL but must use tag format if present)
    let referenceRequests: Array<{project: string; branch?: string; reason?: string}> | undefined;
    const referencesMatch = rawResponse.match(/<references>\s*([\s\S]*?)\s*<\/references>/);
    
    if (referencesMatch) {
      try {
        const parsed = JSON.parse(prepareTagJson(referencesMatch[1]));
        // ✅ Accept empty array (no references)
        if (Array.isArray(parsed)) {
          referenceRequests = parsed.length > 0 ? parsed : undefined;
        } else {
          console.warn('⚠️  [Decompose] <references> tag content is not an array, ignoring');
        }
      } catch (error) {
        console.warn('⚠️  [Decompose] Failed to parse <references> tag content:', error);
      }
    }
    
    // `<selectedSpec>` was removed — the active spec is derived from RAC
    // role='ref' artifacts at the caller. See `ArtifactPoolView.activeSpecRefFilename()`.

    let boundary: Boundary | undefined;
    const boundaryMatch = rawResponse.match(/<boundary>\s*(heavyweight|lightweight)\s*<\/boundary>/i);
    if (boundaryMatch) {
      boundary = boundaryMatch[1].toLowerCase() as Boundary;
      console.log(`📋 [Decompose] Boundary classification: ${boundary}`);
    }

    // ExecutionTier classification (LLM-judged, 5-tier SSOT). The caller
    // (`decompose/index.ts`) runs `validateExecutionTier` inside a retry
    // loop; missing tag OR Tier 0 for generate/refactor throws
    // `ExecutionTierViolation` and is retried with framing. We stay
    // silent here on undefined — the retry loop emits its own diagnostic.
    const executionTier = parseExecutionTierTag(rawResponse);
    if (executionTier !== undefined) {
      console.log(`🧭 [Decompose] ExecutionTier: ${executionTier}`);
    }

    let directHints: { targetFiles?: string[]; explorationScope?: string } | undefined;
    const directHintsMatch = rawResponse.match(/<directHints>\s*([\s\S]*?)\s*<\/directHints>/i);
    if (directHintsMatch) {
      const body = directHintsMatch[1].trim();
      if (body && body !== '{}') {
        try {
          const parsedHints = JSON.parse(prepareTagJson(body));
          const targetFiles = Array.isArray(parsedHints?.targetFiles)
            ? parsedHints.targetFiles.filter((f: unknown) => typeof f === 'string' && f.length > 0)
            : undefined;
          const explorationScope = typeof parsedHints?.explorationScope === 'string' && parsedHints.explorationScope.trim().length > 0
            ? parsedHints.explorationScope.trim()
            : undefined;
          if (targetFiles?.length || explorationScope) {
            directHints = { targetFiles, explorationScope };
          }
        } catch (error) {
          console.warn('⚠️  [Decompose] Failed to parse <directHints> tag content:', error);
        }
      }
    }

    let specClarify: SpecClarify | undefined;
    const specClarifyMatch = rawResponse.match(/<specClarify>\s*([\s\S]*?)\s*<\/specClarify>/i);
    if (specClarifyMatch) {
      const body = specClarifyMatch[1].trim();
      if (body && body !== '{}' && body.toLowerCase() !== 'null') {
        try {
          const parsed = JSON.parse(prepareTagJson(body));
          if (parsed && parsed.needsChoice === true
            && parsed.choiceOptions?.positive?.action
            && parsed.choiceOptions?.neutral?.action
            && parsed.choiceOptions?.negative?.action
          ) {
            specClarify = parsed as SpecClarify;
            console.log('📝 [Decompose] specClarify requested by LLM');
          } else {
            console.warn('⚠️  [Decompose] <specClarify> missing required fields, ignoring');
          }
        } catch (error) {
          console.warn('⚠️  [Decompose] Failed to parse <specClarify> tag content:', error);
        }
      }
    }

    return {
      tasks,
      referenceRequests,
      techTier,
      boundary,
      executionTier,
      directHints,
      specClarify,
    };
    
  } catch (error) {
    console.error('❌ [Decompose] Failed to parse LLM response:', error);
    console.error('Raw response:', rawResponse.substring(0, 500));
    throw error;
  }
}

/**
 * Create task queue from parsed tasks
 *
 * Tier-Verification Alignment (SSOT):
 *   - Tier 2 (Exploratory, single unit of work) → MUST emit exactly 1 task with
 *     `selfVerifyOnDone:true`. The sole task owns install/typecheck/build/test
 *     inline; no separate verification task.
 *   - Tier 3 / Tier 4 (Task / RefsGrounded) → MUST emit `>= 2` tasks INCLUDING a
 *     dedicated verification task (priority 1000).
 *   - Tier 0 / Tier 1 → `<tasks>[]`. Caller (`decompose/index.ts`) short-circuits
 *     before this function is invoked; receiving a non-empty task list at these
 *     tiers is a contract violation from the caller, not this function's concern.
 *
 * `executionTier` is REQUIRED. `decompose/index.ts` always passes the value
 * returned by `validateExecutionTier`, which throws `ExecutionTierViolation`
 * on a missing LLM tag OR on Tier 0 for generate/refactor modes (retry loop
 * re-issues the call with violation-specific framing). There is no silent
 * fallback to Tier 0 Reflex — that legacy path was removed because it
 * masked prompt drift as a no-op "success".
 *
 * `error/hooks/orchestrator.ts::onTaskComplete` still auto-enqueues a Final
 * Verification (downgraded to defense-in-depth) when decompose failed to emit
 * one at Tier 3/4. That is a regression fallback, not the primary path.
 */
export function createTaskQueue(
  tasks: CodeTask[],
  activeSpecRefFilename: string | null | undefined,
  defaultUiSource: UiSource | undefined,
  executionTier: ExecutionTierId,
  mode: ArtifactPolicyMode = 'infer',
): {
  taskQueue: TaskQueue<CodeTask>;
  featureTasks: Map<string, CodeTask>;
} {
  const taskQueue = new TaskQueue<CodeTask>();
  const featureTasks = new Map<string, CodeTask>();

  const hasFinalTask = tasks.some(task => task.priority === TASK_PRIORITIES.FINAL_VERIFICATION);

  // ─────────────────────────────────────────────────────────────
  // Tier-Verification Alignment — count / shape validation
  // ─────────────────────────────────────────────────────────────
  //
  // Tier 2 (Exploratory, single unit of work): exactly 1 task, with
  // `selfVerifyOnDone === true` (except for explain tasks which have no
  // gates to run).
  //
  // Tier 3/4 (Task / RefsGrounded): >= 2 tasks, verification task mandatory.
  //
  // Tier 0 / Tier 1: caller short-circuits before reaching this function —
  // it only fires when `executionTier >= 2`. Any task count / shape issue at
  // Tier 0/1 is a caller bug, not surfaced here.
  if (executionTier === 2) {
    if (tasks.length !== 1) {
      throw new Error(
        `❌ [Decompose] Tier 2 (Exploratory, single unit of work) requires EXACTLY one task, got ${tasks.length}.\n` +
        `If the directive truly needs more than one independent unit of work, classify as ` +
        `Tier 3 instead (with a mandatory verification task). If it needs less, classify as ` +
        `Tier 0/1 and emit <tasks>[] via the direct path.\n`
      );
    }
    const sole = tasks[0];
    const isExplain = (sole.type as string) === 'explain';
    const flag = (sole as any).selfVerifyOnDone;
    if (!isExplain && flag !== true) {
      throw new Error(
        `❌ [Decompose] Tier 2 task "${sole.id || sole.name}" is missing selfVerifyOnDone:true.\n` +
        `Every Tier 2 non-explain task MUST set selfVerifyOnDone:true — the task owns its own ` +
        `install/typecheck/build/test gates before emitting <done>true</done>. This is the SSOT ` +
        `that lets the command guard allow verification commands for this task.\n`
      );
    }
  } else if (executionTier >= 3) {
    if (tasks.length < 2) {
      throw new Error(
        `❌ [Decompose] Tier ${executionTier} requires AT LEAST 2 tasks (work task(s) + mandatory ` +
        `verification task), got ${tasks.length}.\n` +
        `A single-unit breakdown belongs at Tier 2 with selfVerifyOnDone:true on the sole task. ` +
        `Tier 3/4 are reserved for multi-unit work where a dedicated verification task governs gates.\n`
      );
    }
    if (!hasFinalTask) {
      throw new Error(
        `❌ [Decompose] Tier ${executionTier} breakdown is missing a Final Verification task ` +
        `(type="verification", priority=1000).\n` +
        `Every Tier 3/4 breakdown MUST include a dedicated verification task — it is the SSOT for ` +
        `install/typecheck/build/test gates across the multi-task pipeline. Error tasks and ` +
        `feature tasks both depend on a following verification task to validate their changes.\n`
      );
    }
  }

  if (hasFinalTask) {
    console.log(`✅ [createTaskQueue] Final Verification task validated (created by LLM)`);
  } else if (executionTier === 2) {
    console.log(`✅ [createTaskQueue] Tier 2 Exploratory — inline selfVerifyOnDone owns verification`);
  }

  tasks.forEach(task => {
    // Determine exclusive flag:
    // - Explicit from LLM takes precedence
    // - Fallback delegated to tasks/{type}/hooks/decompose.ts → isExclusive
    //   (setup / error / verification = always true; feature = priority===1000;
    //    ui / design-system / test-code / doc have no hook → fall through to false).
    // R1 — the phase layer is blind to task.type; the dispatch registry owns
    // the per-type predicate.
    const isExplicitExclusive = typeof (task as any).exclusive === 'boolean' ? (task as any).exclusive : undefined;
    const isTypeExclusive =
      hooksForTaskType(task.type)?.decompose?.isExclusive?.(task) ?? false;
    const exclusive = isExplicitExclusive ?? isTypeExclusive;
    
    // parallelGroup only applies when not exclusive
    const parallelGroup = !exclusive && typeof (task as any).parallelGroup === 'string' 
      ? (task as any).parallelGroup 
      : undefined;
    
    // Determine task type: final verification tasks are always 'verification'.
    // When the decompose LLM omits `type`, fall back to the canonical default
    // declared by `tasks/_shared/types.ts` (`DEFAULT_TASK_TYPE = 'feature'`)
    // so the literal lives in exactly one place (R1-compliant).
    const resolvedType = task.priority === TASK_PRIORITIES.FINAL_VERIFICATION
      ? 'verification' as const
      : (task.type || DEFAULT_TASK_TYPE);

    const uiSections: string[] | undefined = Array.isArray((task as any).uiSections) ? (task as any).uiSections : undefined;
    const packages: string[] | undefined = Array.isArray((task as any).packages) ? (task as any).packages : undefined;

    // Resolve uiSource: explicit task field wins, otherwise inherit the pool-derived
    // default from the decompose node. Only UI-related task types consume this field;
    // everything else drops it. Kept undefined (not written) for non-UI tasks so the
    // BaseTask.uiSource contract stays clean.
    const explicitUiSource = typeof (task as any).uiSource === 'string' ? (task as any).uiSource as UiSource : undefined;
    const inheritedUiSource = explicitUiSource ?? defaultUiSource;
    const isUiRelated = isUiTask({ type: resolvedType }) || isDesignSystemTask({ type: resolvedType });
    const uiSource: UiSource | undefined = isUiRelated ? inheritedUiSource : undefined;

    // artifactPolicy: role-annotated selection; include: flat backward-compat projection.
    //
    // `mode` threads the RAC-source gate (Channel B closure). When
    // `mode === 'explicit'` the user pinned refs/context — `packages` is
    // a tech-tier hint only and MUST NOT auto-synthesize `fe-system-X.md`
    // refs (`mossy-nearing-gleam` regression). The LLM may still emit a
    // bare `include` array; we keep that pass-through but it is ignored
    // by the explicit pipeline because explicit mode in
    // `execute/buildMessages` selects from the RAC pool directly via
    // `state.resolvedAction.{refs,context}` rather than `task.include`.
    const explicitInclude: string[] | undefined = Array.isArray((task as any).include) ? (task as any).include : undefined;
    const artifactPolicy = deriveArtifactPolicy(resolvedType, packages, uiSections, activeSpecRefFilename, uiSource, mode);
    const include = explicitInclude ?? flattenPolicyToInclude(artifactPolicy);

    // Tier-Verification Alignment: Tier 2 Exploratory self-verify flag passthrough.
    //   - Emitted by the decompose LLM at Tier 2 (exactly one task).
    //   - Ignored (dropped) at Tier 3/4 because the dedicated verification task
    //     governs gates there; letting the flag leak onto a Tier 3 task would
    //     trick the command guard into allowing build/test/typecheck during
    //     execute for tasks that are supposed to defer to verification.
    const rawSelfVerify = (task as any).selfVerifyOnDone;
    const selfVerifyOnDone =
      executionTier === 2 && typeof rawSelfVerify === 'boolean'
        ? rawSelfVerify
        : undefined;

    const normalizedTask: CodeTask = {
      id: task.id || `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: task.name,
      type: resolvedType,
      priority: task.priority || TASK_PRIORITIES.FEATURE_NORMAL,
      description: task.description,
      errors: task.errors,
      category: task.category,
      uiSections,
      packages,
      include,
      artifactPolicy,
      uiSource,
      exclusive: exclusive || undefined,
      parallelGroup,
      selfVerifyOnDone,
    };
    
    taskQueue.push(normalizedTask);

    if (isFeatureTask(normalizedTask)) {
      featureTasks.set(normalizedTask.id, normalizedTask);
    }
  });
  
  return { taskQueue, featureTasks };
}

/**
 * Log task breakdown summary
 */
export function logTaskSummary(
  tasks: CodeTask[],
  referenceRequests?: Array<{project: string; branch?: string; reason?: string}>
): void {
  console.log(`\n✅ Task breakdown complete:`);

  // Count task types via task.type as a generic key (R1 — no `task.type === '...'`
  // literal comparisons). FINAL_VERIFICATION alias re-routes feature→verification
  // so historical decompositions that set priority=1000 without retype still
  // show up under the correct bucket.
  const countByType: Record<string, number> = {};
  for (const t of tasks) {
    const bucket = t.priority === TASK_PRIORITIES.FINAL_VERIFICATION ? 'verification' : (t.type as string);
    countByType[bucket] = (countByType[bucket] ?? 0) + 1;
  }

  console.log(`   Total tasks: ${tasks.length}`);
  console.log(`   Setup: ${countByType.setup ?? 0}`);
  if (countByType['design-system']) console.log(`   Design-System: ${countByType['design-system']}`);
  console.log(`   Feature: ${countByType.feature ?? 0}`);
  if (countByType.ui) console.log(`   UI: ${countByType.ui}`);
  console.log(`   Test-Code: ${countByType['test-code'] ?? 0}`);
  console.log(`   Error: ${countByType.error ?? 0}`);
  console.log(`   Verification: ${countByType.verification ?? 0}`);
  
  // Parallel execution summary
  const exclusiveTasks = tasks.filter(t => t.exclusive);
  const parallelGroups = new Set(tasks.filter(t => t.parallelGroup).map(t => t.parallelGroup));
  if (exclusiveTasks.length > 0 || parallelGroups.size > 0) {
    console.log(`   🔀 Parallel hints:`);
    console.log(`      Exclusive: ${exclusiveTasks.length} tasks (${exclusiveTasks.map(t => t.id).join(', ')})`);
    console.log(`      Parallel groups: ${parallelGroups.size > 0 ? [...parallelGroups].join(', ') : 'none'}`);
  }
  
  // Log reference requests
  if (referenceRequests && referenceRequests.length > 0) {
    console.log(`\n📚 Reference projects requested:`);
    referenceRequests.forEach(ref => {
      console.log(`   - ${ref.project}${ref.branch ? ` (${ref.branch})` : ''}`);
      if (ref.reason) {
        console.log(`     Reason: ${ref.reason}`);
      }
    });
  }
  
  console.log('');
}

