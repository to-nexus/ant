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
  saveCheckpoint,
  enterDecomposeNode,
  exitDecomposeNode,
} from "./helpers";
import { decomposeUiDesign } from "./uiDesignDecompose";
import { decomposeSystemDesign } from "./systemDesignDecompose";

// ============================================
// UI Design Prerequisites Validation
// ============================================

function validateUiDesignPrerequisites(state: DesignGraphState): void {
  const hasReferences = state.uiReferences?.screens?.length || state.uiReferences?.components?.length;
  const hasAssets = state.uiAssetsList?.logos?.length || 
                    state.uiAssetsList?.backgrounds?.length || 
                    state.uiAssetsList?.icons?.length || 
                    state.uiAssetsList?.other?.length;

  if (!hasReferences && !hasAssets) {
    throw new Error(
      "UI 문서 생성에 필요한 입력 파일이 없습니다.\n\n" +
      "필수 입력:\n" +
      "- inputs/references/screens/ - 피그마 화면 캡처 이미지\n" +
      "- inputs/references/components/ - 컴포넌트 상태 스냅샷 (선택)\n" +
      "- inputs/assets/ - 런타임 에셋 파일들 (선택)\n\n" +
      "위 폴더에 최소 하나 이상의 이미지/에셋 파일을 추가해주세요."
    );
  }

  if (!hasReferences) {
    throw new Error(
      "UI 문서 생성을 위한 레퍼런스 이미지가 없습니다.\n\n" +
      "inputs/references/screens/ 폴더에 피그마 화면 캡처 이미지를 추가해주세요.\n" +
      "- 스크린샷은 화면 레이아웃, 색상, 타이포그래피 분석에 사용됩니다.\n" +
      "- 가능하면 다양한 해상도/상태의 스크린샷을 포함해주세요."
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
// Fallback Task (on LLM failure)
// ============================================

async function handleFallbackTask(
  state: DesignGraphState,
  timing: TimingContext
): Promise<DesignGraphState> {
  const defaultTask = createDefaultTask();
  const taskQueue = new TaskQueue<DesignTask>();
  taskQueue.push(defaultTask);

  await saveCheckpoint(state, {
    taskQueue: taskQueue.getAll(),
    completedTasks: [],
    completedTasksDetails: [],
    jobId: timing.newJobId,
    jobTiming: timing.newJobTiming,
  });

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
    // System Design: check spec availability
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const hasSpec = Boolean(state.prd || state.design || state.directive);
    if (!hasSpec) {
      return handleDefaultTask(state, timing);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // System Design: LLM-driven decomposition
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    try {
      return await decomposeSystemDesign(state, {
        phaseStart,
        newJobId: timing.newJobId,
        newJobTiming: timing.newJobTiming,
        estimatingStartTime: timing.estimatingStartTime,
      });
    } catch (error) {
      console.error('❌ Decomposition failed, falling back to default task');
      return handleFallbackTask(state, timing);
    }
  } finally {
    await exitDecomposeNode(state);
  }
}
