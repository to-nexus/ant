/**
 * Decompose Node for Design
 * 
 * Entry point that orchestrates design task decomposition.
 * Routes to appropriate handler based on work type (UI design / system design).
 */

import { DesignGraphState } from "../../state";
import { DesignTask } from "../../../../types/task";
import { TaskQueue } from "../../../../types/task";
import { JobTimingManager } from "../../../../../common/graph/timing/JobTimingManager";
import { getEstimatingLabel } from "../../../../../common/graph/timing/estimatingLabels";
import { createDefaultTask, createExplainTask } from "./defaults";
import { updateKanban } from "./kanbanUpdate";
import { enterDecomposeNode, exitDecomposeNode } from "./workflowInstrument";
import { decomposeUiDesign } from "./uiDesignDecompose";
import { decomposeGameArtDesign } from "./gameArtDesignDecompose";
import { decomposeSystemDesign } from "./systemDesignDecompose";
import { decomposeSpec } from "./specDecompose";
import { BOUNDARY, isFigmaPipeline, isFigmaDataPopulated } from "@ant/shared";
import { ArtifactPoolView } from "../../../../../../core/prompt/builder/ArtifactPipeline";
import { ExecutionTierId, recordUserTurnMeta } from "../../../../../../core/executionTier";
import { emitDetectOutcome } from "../../../../../../core/streaming/emitDetectOutcome";

// ============================================
// UI Design Prerequisites Validation
// ============================================

function validateUiDesignPrerequisites(state: DesignGraphState): void {
  // Figma mode is the only branch that needs a hard prerequisite check —
  // the figma.json file must exist and carry a Figma URL. Description-mode
  // (gen-ui-desc) and refactor (rev-ui) get their authoritative inputs
  // from the RAC pool (PRD / existing UI doc) and need no extra gate here.
  if (isFigmaPipeline(state.resolvedAction?.intent, isFigmaDataPopulated(state.figmaConfig))) {
    if (!state.figmaConfig?.file) {
      throw new Error(
        "No Figma file configured for UI document generation.\n\n" +
        "Required: figma.json with a Figma URL in the 'file' field."
      );
    }
  }
}

/**
 * Validate prerequisites for game-art design intents (`gen-game-art-figma`,
 * `gen-game-art-desc`, `rev-game-art`).
 *
 * - `gen-game-art-figma` requires a Figma config (same shape as ui-figma).
 * - `gen-game-art-desc` is directive-only — no references / assets required.
 * - `rev-game-art` requires existing `visual/game-art/ant/` documents
 *   (validated upstream by RAC; this fn is permissive here). D24-revised v8 —
 *   game-art is sub-sourced, mirroring ui/ant.
 */
function validateGameArtDesignPrerequisites(state: DesignGraphState): void {
  const intent = state.resolvedAction?.intent;

  if (intent === 'gen-game-art-figma') {
    if (!state.figmaConfig?.file) {
      throw new Error(
        "No Figma file configured for game-art document generation.\n\n" +
        "Required: figma.json with a Figma URL in the 'file' field."
      );
    }
  }
}

// ============================================
// Job Timing Setup
// ============================================

interface TimingContext {
  newJobId: string;
  newJobTiming: any;
  estimatingStartTime: string;
}

function initializeJobTiming(state: DesignGraphState): TimingContext {
  const existingJobTiming = state.jobTiming;
  const existingJobId = state.jobId;

  if (existingJobTiming && existingJobId) {
    return {
      newJobId: existingJobId,
      newJobTiming: existingJobTiming,
      estimatingStartTime: existingJobTiming.startedAt,
    };
  }

  // Fallback: initialize fresh (shouldn't happen in normal flow)
  console.warn(`⚠️  [Design Decompose] No jobTiming from resolve, initializing fresh`);
  const init = JobTimingManager.initializeNewJob(state._httpJobId!);
  
  if (state.deps?.kanbanUpdate?.setJobTiming) {
    state.deps.kanbanUpdate.setJobTiming(init.jobTiming);
  }

  return {
    newJobId: init.jobId,
    newJobTiming: init.jobTiming,
    estimatingStartTime: init.estimatingStartTime,
  };
}

// ============================================
// Preload Completed Tasks
// ============================================

async function preloadCompletedTasks(state: DesignGraphState): Promise<any[]> {
  if (!state.deps?.session) return [];
  try {
    const session = await state.deps.session.load(
      state.context.project,
      state.context.featureFolder || 'default',
      'design'
    );
    return session.state?.completedTasksDetails || [];
  } catch {
    return [];
  }
}

// ============================================
// Explain Mode Handler
// ============================================

async function handleExplainMode(
  state: DesignGraphState,
  timing: TimingContext
): Promise<DesignGraphState> {
  const explainTask = createExplainTask(state);
  const taskQueue = new TaskQueue<DesignTask>();
  taskQueue.push(explainTask);

  updateKanban(state, explainTask, []);

  // Explain mode does not call the LLM for tier judgment — it is a
  // read-only explanation path, so Tier 0 Reflex is the fixed tier.
  // Recording the meta patch keeps parity with the three LLM-driven
  // decompose* variants so the UI tier badge and the resolve →
  // featureContextBuilder hint see a consistent event shape.
  await recordUserTurnMeta({
    session: state.deps?.session,
    turnId: state.turnId,
    jobId: timing.newJobId,
    jobType: 'design',
    executionTier: ExecutionTierId.Reflex,
    nodeLabel: 'DesignDecompose:explain',
  });

  return {
    ...state,
    taskQueue,
    currentTask: explainTask,
    completedTasks: [],
    completedTasksDetails: [],
    jobId: timing.newJobId,
    jobTiming: timing.newJobTiming,
    executionTier: ExecutionTierId.Reflex,
    boundary: BOUNDARY.LIGHTWEIGHT,
  };
}

// ============================================
// Default Task Fallback
// ============================================

async function handleDefaultTask(
  state: DesignGraphState,
  timing: TimingContext
): Promise<DesignGraphState> {
  const defaultTask = createDefaultTask();
  const taskQueue = new TaskQueue<DesignTask>();
  taskQueue.push(defaultTask);

  updateKanban(state, null, taskQueue.getAll());

  // No spec / source to ground the breakdown — no LLM tier judgment
  // runs. Inject Tier 0 Reflex as the fixed tier and record the meta
  // patch (parity with the three decompose* variants above).
  await recordUserTurnMeta({
    session: state.deps?.session,
    turnId: state.turnId,
    jobId: timing.newJobId,
    jobType: 'design',
    executionTier: ExecutionTierId.Reflex,
    nodeLabel: 'DesignDecompose:fallback',
  });

  return {
    ...state,
    taskQueue,
    completedTasks: [],
    _httpJobId: state._httpJobId,
    jobId: timing.newJobId,
    jobTiming: timing.newJobTiming,
    executionTier: ExecutionTierId.Reflex,
    boundary: BOUNDARY.LIGHTWEIGHT,
  } as any;
}


// ============================================
// Main Entry Point
// ============================================

export async function decompose(state: DesignGraphState): Promise<DesignGraphState> {
  const result = await runDesignDecompose(state);

  // Re-emit the finalized basis once the sub-handler has completed.
  // Routed through the Canonical Tag Rendering SSOT (SpecialTagTransformer
  // via emitDetectOutcome) — no bespoke formatting lives here.
  if (result.resolvedAction) {
    void emitDetectOutcome(result.resolvedAction, {
      locale: result._uiLocale ?? state._uiLocale,
      phase: 'decompose-final',
    });
  }

  return result;
}

async function runDesignDecompose(state: DesignGraphState): Promise<DesignGraphState> {
  const phaseStart = Date.now();

  // Defense-in-depth invariant. routeAfterDetect (design/routing.ts) must
  // end the graph when resolvedAction is unset (detect emitted blocked /
  // redirect-suggested without writing it). Reaching decompose without an
  // RAC means routing regressed — throw loudly instead of falling through
  // to the system-design branch (the silver-boiling-grape symptom).
  if (!state.resolvedAction) {
    throw new Error(
      '[Design Decompose] Invariant violation: state.resolvedAction is unset. ' +
      'Detect must populate resolvedAction before routing here — see design/routing.ts:routeAfterDetect.',
    );
  }

  console.log('\n📋 ══════════════════════════ DESIGN DECOMPOSE PHASE ══════════════════════════');
  console.log(`   Intent group: ${state.resolvedAction.intentGroup || 'unknown'}`);
  console.log(`   Job mode: ${state.resolvedAction.mode || 'unknown'}`);
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Activity banner
  if (state.deps?.kanbanUpdate?.setEstimatingActivity) {
    state.deps.kanbanUpdate.setEstimatingActivity(getEstimatingLabel('decompose', state._uiLocale), 'decompose');
  }

  // Validate UI / Game-Art design prerequisites
  if (state.resolvedAction?.intentGroup === 'design-ui') {
    validateUiDesignPrerequisites(state);
  } else if (state.resolvedAction?.intentGroup === 'design-game-art') {
    validateGameArtDesignPrerequisites(state);
  }

  // Workflow enter
  await enterDecomposeNode(state);

  try {
    // Job timing
    const timing = initializeJobTiming(state);

    // Preload completed tasks & send estimating signal
    const preloadedCompletedTasks = await preloadCompletedTasks(state);
    updateKanban(state, null, [], preloadedCompletedTasks, 0);

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Explain mode: skip decompose, create single explain task
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (state.resolvedAction?.mode === 'explain') {
      return await handleExplainMode(state, timing);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // UI Design mode: LLM-driven decomposition
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (state.resolvedAction?.intentGroup === 'design-ui') {
      return decomposeUiDesign(state, {
        phaseStart,
        newJobId: timing.newJobId,
        newJobTiming: timing.newJobTiming,
      });
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Game-Art Design mode: LLM-driven decomposition (D17/D28)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (state.resolvedAction?.intentGroup === 'design-game-art') {
      return decomposeGameArtDesign(state, {
        phaseStart,
        newJobId: timing.newJobId,
        newJobTiming: timing.newJobTiming,
      });
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Spec mode: single task for spec document generation
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (state.resolvedAction?.intentGroup === 'design-spec') {
      return decomposeSpec(state, {
        phaseStart,
        newJobId: timing.newJobId,
        newJobTiming: timing.newJobTiming,
      });
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // System Design: check spec availability
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const pool = new ArtifactPoolView(state.artifacts || []);
    const hasSpec = Boolean(pool.hasSources() || pool.hasSystemDesign() || state.directive);
    if (!hasSpec) {
      return handleDefaultTask(state, timing);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // System Design: LLM-driven decomposition
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // decomposeSystemDesign handles retry + minimum-task fallback internally.
    // If it still throws, it's unrecoverable — let the error propagate.
    return await decomposeSystemDesign(state, {
      phaseStart,
      newJobId: timing.newJobId,
      newJobTiming: timing.newJobTiming,
      estimatingStartTime: timing.estimatingStartTime,
    });
  } finally {
    await exitDecomposeNode(state);
  }
}
