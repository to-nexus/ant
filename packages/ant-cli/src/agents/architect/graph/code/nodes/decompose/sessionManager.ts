import { ArchitectGraphState } from "../../state";
import { TaskQueue } from "../../../../types/task";
import { CodeTask } from "../../../../types/task";
import type { Session } from '../../../../../../core/types/session';
import { isFeatureTask } from '../../tasks/feature';

/**
 * Check if session exists and should be restored
 */
export async function checkSessionRestore(
  state: ArchitectGraphState
): Promise<{
  shouldRestore: boolean;
  session?: Session;
  hasAdditionalDirective: boolean;
  shouldResetAndDecompose: boolean;
  mergedDirective?: string;
}> {
  const sessionPort = state.deps?.session;
  const project = state.context.project;
  const feature = state.context.feature;
  
  if (!sessionPort || !project || !feature) {
    return { 
      shouldRestore: false, 
      hasAdditionalDirective: false,
      shouldResetAndDecompose: false
    };
  }
  
  try {
    const session = await sessionPort.load(project, feature, 'code');
    
    if (!session?.state?.taskQueue) {
      return { 
        shouldRestore: false, 
        hasAdditionalDirective: false,
        shouldResetAndDecompose: false
      };
    }
    
    // Check for additional directive (replan scenario)
    const currentDirective = state.directive?.trim();
    // Get directive from state (may be array or string)
    const previousDirective = Array.isArray(session.state.directives) 
      ? session.state.directives[0]?.trim()
      : session.state.directive?.trim();
    const hasAdditionalDirective = Boolean(
      currentDirective && 
      previousDirective && 
      currentDirective !== previousDirective
    );
    
    // Merge directives if replan detected
    const mergedDirective = hasAdditionalDirective
      ? `${previousDirective}\n\n[ADDITIONAL REQUEST]\n${currentDirective}`
      : currentDirective;
    
    // Check for RESET keyword (user wants to start over)
    const shouldResetAndDecompose = Boolean(
      currentDirective?.toLowerCase().includes('reset') ||
      currentDirective?.toLowerCase().includes('리셋') ||
      currentDirective?.toLowerCase().includes('처음부터')
    );
    
    if (shouldResetAndDecompose) {
      console.log('🔄 [Decompose] RESET detected - clearing session and decomposing fresh');
      // Clear session if method exists
      if ('clear' in sessionPort && typeof (sessionPort as any).clear === 'function') {
        await (sessionPort as any).clear(project, feature, 'code');
      }
      return {
        shouldRestore: false,
        hasAdditionalDirective: false,
        shouldResetAndDecompose: true
      };
    }
    
    return {
      shouldRestore: true,
      session,
      hasAdditionalDirective,
      shouldResetAndDecompose: false,
      mergedDirective
    };
    
  } catch (error) {
    console.warn('⚠️  [Decompose] Session check failed:', error);
    return { 
      shouldRestore: false, 
      hasAdditionalDirective: false,
      shouldResetAndDecompose: false
    };
  }
}

/**
 * Restore state from session
 */
export function restoreFromSession(
  state: ArchitectGraphState,
  session: Session
): ArchitectGraphState {
  if (!session.state) {
    return state;
  }

  const taskQueue = TaskQueue.from<CodeTask>(session.state.taskQueue ?? []);
  
  const featureTasks = new Map<string, CodeTask>();
  (session.state.taskQueue ?? []).forEach((task: CodeTask) => {
    if (isFeatureTask(task)) {
      featureTasks.set(task.id, task);
    }
  });

  // Count task types for progress display. R1 — no `task.type === '...'`
  // comparisons; use task.type as a generic key and route final-
  // verification tasks into the `verification` bucket via the
  // bundle's classify hook. `responseParser.createTaskQueue` retypes
  // any priority>=VERIFICATION_PRIORITY task to `type: 'verification'` at
  // decompose time (single upstream SSOT — see `responseParser.ts`
  // resolvedType branch), so the classify lookup here always finds
  // the verification bundle for final-priority tasks.
  const tasksByType: Record<string, number> = {
    setup: 0,
    feature: 0,
    'test-code': 0,
    doc: 0,
    error: 0,
    verification: 0,
  };

  // Three-Axis SSOT: verification is type-fixed — `task.type === 'verification'`
  // is the canonical "final" predicate. The classify hook is consulted as a
  // safety net for legacy snapshots that may omit `type` while carrying
  // `priority: 1000`; for those, the doc bundle's classify reads priority.
  const classifyTask = (task: CodeTask) => {
    const isFinal = task.type === 'verification';
    const bucket = isFinal ? 'verification' : task.type;
    tasksByType[bucket] = (tasksByType[bucket] ?? 0) + 1;
  };

  taskQueue.getAll().forEach(classifyTask);

  if (session.state.currentTask) {
    classifyTask(session.state.currentTask as CodeTask);
  }
  
  const completedCount = session.state.completedTasks?.length || 0;
  const inProgressCount = session.state.currentTask ? 1 : 0;
  const totalTasks = completedCount + taskQueue.size() + inProgressCount;
  
  console.log(`📊 Resuming existing project:`);
  console.log(`   Progress: ${completedCount}/${totalTasks} tasks (${Math.round(completedCount / totalTasks * 100)}%)`);
  console.log(`   `);
  console.log(`   Setup:   ${tasksByType.setup === 0 ? '✅' : '⬜'} ${tasksByType.setup} remaining`);
  console.log(`   Feature: ${tasksByType.feature === 0 ? '✅' : '⬜'} ${tasksByType.feature} remaining`);
  console.log(`   Test-Code: ${tasksByType['test-code'] === 0 ? '✅' : '⬜'} ${tasksByType['test-code']} remaining`);
  console.log(`   Doc:     ${tasksByType.doc === 0 ? '✅' : '⬜'} ${tasksByType.doc} remaining`);
  console.log(`   Error:   ${tasksByType.error === 0 ? '✅' : '⚠️ '} ${tasksByType.error} remaining`);
  console.log(`   Verify:  ${tasksByType.verification === 0 ? '✅' : '⬜'} ${tasksByType.verification} remaining`);
  console.log(``);
  
  if (session.state.referenceRequests && session.state.referenceRequests.length > 0) {
    console.log(`📚 Restored ${session.state.referenceRequests.length} reference project(s):`);
    session.state.referenceRequests.forEach((ref: any) => {
      console.log(`   - ${ref.project}${ref.branch ? ` (${ref.branch})` : ''}`);
    });
    console.log('');
  }
  
  return {
    ...state,
    ...session.state,
    taskQueue,
    featureTasks,
    totalSubtasks: totalTasks
  } as ArchitectGraphState;
}

