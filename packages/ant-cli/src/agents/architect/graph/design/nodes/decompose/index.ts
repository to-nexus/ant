/**
 * Decompose Node for Design
 * 
 * Entry point that orchestrates design task decomposition.
 * Routes to appropriate handler based on work type (UI design / system design).
 */

import { DesignGraphState } from "../../state";
import { DesignTask } from "../../../../types/task";
import { TaskQueue } from "../../../code/state";
import { JobTimingManager } from "../../../../../common/graph/timing/JobTimingManager";
import { getEstimatingLabel } from "../../../../../common/graph/timing/estimatingLabels";
import {
  createDefaultTask,
  createExplainTask,
  updateKanban,
  enterDecomposeNode,
  exitDecomposeNode,
} from "./helpers";
import { decomposeUiDesign } from "./uiDesignDecompose";
import { decomposeSystemDesign } from "./systemDesignDecompose";
import { decomposeSpec } from "./specDecompose";

// ============================================
// UI Design Prerequisites Validation
// ============================================

function validateUiDesignPrerequisites(state: DesignGraphState): void {
  // Figma mode: references come from Figma MCP, not local files
  if (state.uiDesignSource === 'figma') {
    if (!state.figmaConfig?.files?.length) {
      throw new Error(
        "No Figma files configured for UI document generation.\n\n" +
        "Required: figma.json with at least one Figma URL in the 'files' array."
      );
    }
    return;
  }

  const hasReferences = state.uiReferences?.length;
  const hasAssets = state.uiAssetsList && Object.values(state.uiAssetsList).some(arr => arr.length > 0);

  if (!hasReferences && !hasAssets) {
    throw new Error(
      "No input files found for UI document generation.\n\n" +
      "Required:\n" +
      "- inputs/references/ - Design reference images (screenshots, component snapshots, etc.)\n" +
      "- inputs/assets/ - Runtime asset files (optional)\n\n" +
      "Please add at least one image or asset file."
    );
  }

  if (!hasReferences) {
    throw new Error(
      "No reference images found for UI document generation.\n\n" +
      "Please add design reference images to inputs/references/.\n" +
      "- Screenshots are used for layout, color, and typography analysis.\n" +
      "- Include diverse viewports and states when possible."
    );
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
  const existingJobTiming = (state as any).jobTiming;
  const existingJobId = (state as any).jobId;

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

function handleExplainMode(
  state: DesignGraphState,
  timing: TimingContext
): DesignGraphState {
  const explainTask = createExplainTask(state);
  const taskQueue = new TaskQueue<DesignTask>();
  taskQueue.push(explainTask);

  updateKanban(state, explainTask, []);

  return {
    ...state,
    taskQueue,
    currentTask: explainTask,
    completedTasks: [],
    completedTasksDetails: [],
    jobId: timing.newJobId,
    jobTiming: timing.newJobTiming,
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

  return {
    ...state,
    taskQueue,
    completedTasks: [],
    _httpJobId: state._httpJobId,
    jobId: timing.newJobId,
    jobTiming: timing.newJobTiming,
  } as any;
}

// ============================================
// Main Entry Point
// ============================================

export async function decompose(state: DesignGraphState): Promise<DesignGraphState> {
  const phaseStart = Date.now();

  console.log('\n📋 ══════════════════════════ DESIGN DECOMPOSE PHASE ══════════════════════════');
  console.log(`   Work type: ${state.detectionReport?.workType || 'unknown'}`);
  console.log(`   Job mode: ${state.detectionReport?.jobMode || 'unknown'}`);
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Activity banner
  if (state.deps?.kanbanUpdate?.setEstimatingActivity) {
    state.deps.kanbanUpdate.setEstimatingActivity(getEstimatingLabel('decompose', state._uiLocale), 'decompose');
  }

  // Validate UI design prerequisites
  if (state.detectionReport?.workType === 'ui-design') {
    validateUiDesignPrerequisites(state);
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
    if (state.detectionReport?.jobMode === 'explain') {
      return handleExplainMode(state, timing);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // UI Design mode: LLM-driven decomposition
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (state.detectionReport?.workType === 'ui-design') {
      return decomposeUiDesign(state, {
        phaseStart,
        newJobId: timing.newJobId,
        newJobTiming: timing.newJobTiming,
      });
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Spec mode: single task for spec document generation
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (state.detectionReport?.workType === 'spec') {
      return decomposeSpec(state, {
        phaseStart,
        newJobId: timing.newJobId,
        newJobTiming: timing.newJobTiming,
      });
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // System Design: check spec availability
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const hasSourceDocs = state.sourceDocuments && Object.keys(state.sourceDocuments).length > 0;
    const hasSpec = Boolean(state.prd || hasSourceDocs || state.design || state.directive);
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
