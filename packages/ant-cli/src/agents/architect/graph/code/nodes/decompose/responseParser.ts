import { TASK_PRIORITIES } from "../../state";
import { TaskQueue } from "../../../../types/task";
import { CodeTask } from "../../../../types/task";
import { extractErrorDetails, createErrorViolation } from "../_common/errorHandler";
import { normalizeLanguage, normalizeFramework } from "../../../../../../utils/languageUtils";
import { ARTIFACT_PREFIX, BOUNDARY, type Boundary, type ExecutionTierId, type SpecClarify, type UiSource, type TaskBand } from '@ant/shared';
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
  asJsonSyntaxViolation,
} from '../../../../../../core/utils/llmResponseParser';

import type { TaskType, GameEngine, TechTier } from '@ant/shared';
import { SUPPORTED_GAME_ENGINES } from '@ant/shared';
import { isWithinRacWhitelist, type RacScope } from './racGate';

/**
 * Three-Axis SSOT — the SOLE phase site that translates `priority` into a
 * semantic `band`. After this point, `task.band` is the canonical input
 * for feature scheduling (the orchestrator never reads `priority` for
 * scheduling decisions).
 *
 *   - priority === SETUP_PROJECT (100)                        → 'root'
 *   - priority ∈ [SHARED_FOUNDATION, FOUNDATION_MAX] (200–299) → 'foundation'
 *   - priority ∈ [INTEGRATION_MIN,   INTEGRATION_MAX] (600–649) → 'integration'
 *   - everything else → undefined (ordinary feature / package setup)
 *
 * NOTE: cross-feature reference closure is the `seam` TaskType (emitted
 * directly, run AFTER ui at priority 700–749), NOT a band — no priority→band
 * mapping for it.
 *
 * Invoked for feature tasks (→ feature bands) AND setup tasks (→ 'root' for
 * the project/framework/workspace-level root setup; undefined for a package
 * setup at 101+). Other types DO NOT carry band (their type alone is the
 * discriminator). `'root'` is the lowest priority (SETUP_PROJECT=100), so a
 * root setup always dequeues before any band-absent setup (101+).
 */
export function deriveBandFromPriority(priority: number): TaskBand | undefined {
  // Root setup: the unique SETUP_PROJECT-priority task. Lowest priority in the
  // queue → first to dequeue; owns root-level artifacts only (never a member).
  if (priority === TASK_PRIORITIES.SETUP_PROJECT) {
    return 'root';
  }
  // Platform is a sub-range carved from the TOP of the foundation window:
  // [PLATFORM_MIN, PLATFORM_MAX] ⊂ [SHARED_FOUNDATION, FOUNDATION_MAX]. Checked
  // FIRST so a feature task in [260, 299] derives 'platform', leaving the
  // effective feature foundation band at [200, 259]. (FOUNDATION_MAX stays 299
  // for the orthogonal design-job `doc` classifier — see state.ts. The
  // `design-system` TYPE also lives in the foundation phase at 200-219; it is
  // not a feature, so this band derivation is never invoked for it.)
  if (
    priority >= TASK_PRIORITIES.PLATFORM_MIN &&
    priority <= TASK_PRIORITIES.PLATFORM_MAX
  ) {
    return 'platform';
  }
  if (
    priority >= TASK_PRIORITIES.SHARED_FOUNDATION &&
    priority <= TASK_PRIORITIES.FOUNDATION_MAX
  ) {
    return 'foundation';
  }
  if (
    priority >= TASK_PRIORITIES.INTEGRATION_MIN &&
    priority <= TASK_PRIORITIES.INTEGRATION_MAX
  ) {
    return 'integration';
  }
  // NOTE: cross-feature reference closure is the `seam` TaskType (emitted
  // directly by the LLM, run AFTER ui), NOT a band — no priority→band mapping.
  return undefined;
}

export interface ParsedTechTier {
  stack: string;
  stackReasoning: string;
  language: string;
  framework?: string | null;
  /**
   * Stack-keyed framework sub-objects. For fullstack jobs the LLM emits each
   * runtime's framework independently here, because FE (browser) and BE (Node)
   * are distinct runtime categories and their frameworks never collapse to one.
   * Single-stack jobs omit both.
   */
  frontend?: Partial<TechTier>;
  backend?: Partial<TechTier>;
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
  /**
   * Tier 3 cross-task analysis brief — free-form markdown body of
   * `<analysis>...</analysis>`. Sealed by Decompose, injected into every
   * per-task `plan` so each task knows the job-level macro goal /
   * cross-cutting concerns / decomposition rationale / (error case)
   * diagnosis + solution direction. Forbidden at Tier 4; skipped at
   * Tier 0/1/2.
   */
  analysis?: string;
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
    return taskMatches.map((m, i) => {
      const body = prepareTagJson(extractFirstJsonObject(m[1]));
      try {
        return JSON.parse(body);
      } catch (err) {
        // Escalate to JsonSyntaxViolation so decompose/index.ts retry loop
        // can re-issue the call with framing (mirrors ExecutionTierViolation).
        throw asJsonSyntaxViolation(err, body, `<task>[${i}] body`);
      }
    });
  }

  const trimmed = inner.trim();
  if (trimmed.length === 0 || trimmed === '[]') {
    return [];
  }

  // Legacy JSON-array contract.
  const legacyBody = prepareTagJson(inner);
  try {
    return JSON.parse(legacyBody);
  } catch (err) {
    throw asJsonSyntaxViolation(err, legacyBody, '<tasks> legacy array body');
  }
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
    
    // ✅ Extract techTier from <techTier> tag (stack + language + framework + frontend/backend sub-objects)
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
          frontend: parsed.frontend || undefined,
          backend: parsed.backend || undefined,
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

    let analysis: string | undefined;
    const analysisMatch = rawResponse.match(/<analysis>\s*([\s\S]*?)\s*<\/analysis>/i);
    if (analysisMatch) {
      const body = analysisMatch[1].trim();
      if (body.length > 0) {
        analysis = body;
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
      analysis,
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
  racScope?: RacScope,
): {
  taskQueue: TaskQueue<CodeTask>;
  featureTasks: Map<string, CodeTask>;
} {
  const taskQueue = new TaskQueue<CodeTask>();
  const featureTasks = new Map<string, CodeTask>();

  const hasFinalTask = tasks.some(task => isVerificationTask(task));

  // ─────────────────────────────────────────────────────────────
  // Tier-Verification Alignment — count / shape validation
  // ─────────────────────────────────────────────────────────────
  //
  // Tier 2 (Exploratory, single unit of work): exactly 1 task, with
  // `selfVerifyOnDone === true` (except for explain tasks which have no
  // gates to run).
  //
  // Tier 3/4 (Task / RefsGrounded): >= 2 tasks, verification task mandatory.
  //   - Tier 3 deep-think directive shape `[feature × 1 + verification × 1]`
  //     is LEGITIMATE. The plan node may later fan out via `batches[]` after
  //     deep-think reasoning. Padding a fake second feature task to satisfy
  //     `>= 2` is forbidden — the verification task IS the second slot.
  //   - Tier 3 multi-unit shape `[feature × N + verification × 1]` requires
  //     unambiguous physical isolation visible at decompose time.
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
    const flag = (sole as { selfVerifyOnDone?: boolean }).selfVerifyOnDone;
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
        `A truly single-unit breakdown with no separate verification needs belongs at Tier 2 ` +
        `with selfVerifyOnDone:true on the sole task. Tier 3/4 always pair work task(s) with a ` +
        `dedicated verification task — even the deep-think single-feature directive case is ` +
        `[feature × 1 + verification × 1] = 2 tasks.\n`
      );
    }
    if (!hasFinalTask) {
      throw new Error(
        `❌ [Decompose] Tier ${executionTier} breakdown is missing a Final Verification task ` +
        `(type="verification", priority=1000).\n` +
        `Every Tier 3/4 breakdown MUST include a dedicated verification task — it is the SSOT for ` +
        `install/typecheck/build/test gates. The deep-think single-feature shape ` +
        `[feature × 1 + verification × 1] also satisfies this requirement.\n`
      );
    }
    // Defense-in-depth: a Tier 3+ work task carrying `selfVerifyOnDone:true`
    // would cross-wire Tier 2/3 semantics. The pass below already drops the
    // flag (`executionTier !== 2 → undefined`), but rejecting upstream
    // surfaces the prompt drift instead of silently masking it. Final
    // Verification tasks are exempted defensively (their type is
    // `verification`; they shouldn't carry the flag, but skipping them keeps
    // the gate narrow).
    const leakedSelfVerify = tasks.find(
      (t) => (t as { selfVerifyOnDone?: boolean }).selfVerifyOnDone === true && !isVerificationTask(t),
    );
    if (leakedSelfVerify) {
      throw new Error(
        `❌ [Decompose] Tier ${executionTier} task "${leakedSelfVerify.id || leakedSelfVerify.name}" ` +
        `has selfVerifyOnDone:true. That flag belongs ONLY to Tier 2 single tasks. ` +
        `Tier 3/4 work tasks defer build/test/typecheck to the dedicated verification task — drop the flag.\n`
      );
    }
  }

  if (hasFinalTask) {
    console.log(`✅ [createTaskQueue] Final Verification task validated (created by LLM)`);
  } else if (executionTier === 2) {
    console.log(`✅ [createTaskQueue] Tier 2 Exploratory — inline selfVerifyOnDone owns verification`);
  }

  // renderable derive (ui-pairing) — SSOT for task.renderable. A `ui` task
  // renders; a feature task sharing a ui task's parallelGroup is styled by that
  // ui pass and therefore renders a visual surface (this includes navigation-
  // chrome hosts, which earn a paired ui pass under the renderable-by-nature
  // rule). A headless feature with no paired ui does NOT render. Drives the SV
  // session body-lifecycle gate; code-derived (not LLM-emitted) = actualize-proof.
  const uiParallelGroups = new Set<string>(
    tasks
      .filter(
        (t) =>
          (t.type || DEFAULT_TASK_TYPE) === 'ui' &&
          typeof (t as any).parallelGroup === 'string',
      )
      .map((t) => (t as any).parallelGroup as string),
  );

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
    // so the literal lives in exactly one place (R1-compliant). The
    // priority=1000 alias is the LLM-facing legacy contract; isVerificationTask
    // recognises it AND any explicit `type: 'verification'`.
    const resolvedType = isVerificationTask(task)
      ? 'verification' as const
      : (task.type || DEFAULT_TASK_TYPE);

    // Resolve uiSource: explicit task field wins, otherwise inherit the pool-derived
    // default from the decompose node. Only UI-related task types consume this field;
    // everything else drops it. Kept undefined (not written) for non-UI tasks so the
    // BaseTask.uiSource contract stays clean. uiSource is an interpretation axis
    // (ui-source-dispatch partial gate), NOT an injection selector — `include`
    // owns injection.
    const explicitUiSource = typeof (task as any).uiSource === 'string' ? (task as any).uiSource as UiSource : undefined;
    const inheritedUiSource = explicitUiSource ?? defaultUiSource;
    const isUiRelated = isUiTask({ type: resolvedType }) || isDesignSystemTask({ type: resolvedType });
    const uiSource: UiSource | undefined = isUiRelated ? inheritedUiSource : undefined;

    // Per-task stack pointer (narrowing). Always single at task level.
    const rawStack = (task as any).stack;
    const stack: 'frontend' | 'backend' | undefined =
      rawStack === 'frontend' || rawStack === 'backend' ? rawStack : undefined;

    // Single injection SSOT — LLM-authored `include`, RAC-validated. When the
    // RAC is pinned (explicit pipeline → racScope set), out-of-RAC paths are
    // dropped with a warning. Belt-and-suspenders: the pool is itself a RAC
    // subset, so `selectArtifacts(pool, {include})` already misses out-of-RAC
    // paths — this guard surfaces the drift loudly. verification tasks carry
    // no include (selectArtifacts returns [] for them regardless).
    const rawInclude: string[] | undefined = Array.isArray((task as any).include) ? (task as any).include : undefined;
    const include: string[] | undefined = rawInclude
      ? rawInclude.filter((p: string) => {
          const ok = isWithinRacWhitelist(p, racScope);
          if (!ok) {
            console.warn(`⚠️ [Decompose] Dropped include path outside RAC: "${p}" (task "${task.id || task.name}")`);
          }
          return ok;
        })
      : undefined;

    // Tier-Verification Alignment: Tier 2 Exploratory self-verify flag passthrough.
    //   - Emitted by the decompose LLM at Tier 2 (exactly one task).
    //   - Ignored (dropped) at Tier 3/4 because the dedicated verification task
    //     governs gates there; letting the flag leak onto a Tier 3 task would
    //     trick the command guard into allowing build/test/typecheck during
    //     execute for tasks that are supposed to defer to verification.
    const rawSelfVerify = (task as { selfVerifyOnDone?: boolean }).selfVerifyOnDone;
    const selfVerifyOnDone =
      executionTier === 2 && typeof rawSelfVerify === 'boolean'
        ? rawSelfVerify
        : undefined;

    const resolvedPriority = task.priority || TASK_PRIORITIES.FEATURE_NORMAL;
    // Three-Axis SSOT: feature tasks carry an explicit `band` derived from
    // the priority window; setup tasks carry 'root' for the SETUP_PROJECT
    // root setup. After decompose, scheduling reads `task.band`
    // (deadlock-immune across batch-split priority decrements).
    const band: TaskBand | undefined =
      resolvedType === 'feature' || resolvedType === 'setup'
        ? deriveBandFromPriority(resolvedPriority)
        : undefined;
    const errorFields = (task as any) as { errors?: string[]; category?: string };

    // Derived renderable flag (see uiParallelGroups above). ui always renders;
    // a feature paired with a ui task (same parallelGroup) renders too.
    const renderable: boolean | undefined =
      resolvedType === 'ui' ||
      (resolvedType === 'feature' &&
        typeof parallelGroup === 'string' &&
        uiParallelGroups.has(parallelGroup))
        ? true
        : undefined;

    const normalizedTask: CodeTask = {
      id: task.id || `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: task.name,
      type: resolvedType,
      priority: resolvedPriority,
      description: task.description,
      include,
      stack,
      uiSource,
      exclusive: exclusive || undefined,
      parallelGroup,
      selfVerifyOnDone,
      ...(renderable ? { renderable } : {}),
      // band lives on feature (foundation/platform/integration) and setup
      // ('root' for the SETUP_PROJECT root setup); only spread when derived.
      ...(band !== undefined && (resolvedType === 'feature' || resolvedType === 'setup')
        ? { band }
        : {}),
      ...(resolvedType === 'error'
        ? { errors: errorFields.errors, category: errorFields.category }
        : {}),
    } as CodeTask;
    
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
  // literal comparisons). The verification alias re-routes feature→verification
  // so historical decompositions that set priority=1000 without retype still
  // show up under the correct bucket.
  const countByType: Record<string, number> = {};
  for (const t of tasks) {
    const bucket = isVerificationTask(t) ? 'verification' : (t.type as string);
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

