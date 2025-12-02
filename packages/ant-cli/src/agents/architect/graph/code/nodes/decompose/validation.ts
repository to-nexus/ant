import { ArchitectGraphState, Task } from "../../state";

/**
 * Detect if directive contains error-related keywords
 */
export function detectErrorInDirective(directive: string | undefined): boolean {
  if (!directive) return false;
  
  const errorKeywords = [
    'error', 'failed', 'exception', 'bug', 'broken', 'crash',
    '에러', '실패', '오류', '버그', '안됨', '안돼', '못하고',
    'not working', 'doesn\'t work', 'issue', 'problem',
    'fix', 'solve', 'resolve'
  ];
  
  const lowerDirective = directive.toLowerCase();
  return errorKeywords.some(keyword => lowerDirective.includes(keyword));
}

/**
 * Validate tasks after decompose to detect over-engineering
 */
export function validateTasks(
  tasks: Task[],
  mode: string | undefined,
  directive: string | undefined,
  hasErrorInDirective: boolean
): void {
  // Skip validation for generate mode
  if (mode === 'generate') return;
  
  // ✅ Refactor/Explain mode: Excessive task count warning
  if ((mode === 'refactor' || mode === 'explain') && tasks.length > 5) {
    console.warn(`
⚠️  [Decompose Validation] WARNING: Generated ${tasks.length} tasks in ${mode} mode.
   This might indicate over-engineering.
   
   Mode: ${mode}
   Directive: ${directive?.substring(0, 100)}...
   
   Expected: 1-3 tasks for bug fixes/refactoring
   Generated: ${tasks.length} tasks
   
   Review: Consider if all tasks are truly necessary.
    `);
  }
  
  // ✅ Error directive: Check if too many tasks
  if (hasErrorInDirective && tasks.length > 3) {
    console.warn(`
⚠️  [Decompose Validation] WARNING: Error detected in directive but ${tasks.length} tasks generated.
   
   Directive contains error keywords: ${directive?.substring(0, 100)}...
   Generated tasks: ${tasks.length}
   
   Expected: 1-2 tasks for error fixes
   Generated: ${tasks.length} tasks
   
   Review: Most errors require only 1-2 focused fixes.
    `);
  }
  
  // ✅ Check first task for over-broad scope in refactor mode
  if ((mode === 'refactor' || mode === 'explain') && tasks.length > 0) {
    const firstTask = tasks[0];
    if (isOverBroadTask(firstTask)) {
      console.warn(`
⚠️  [Decompose Validation] WARNING: First task seems too broad for ${mode} mode.
   
   Task: ${firstTask.name}
   Description: ${firstTask.description.substring(0, 150)}...
   
   Expected: Focused fix (e.g., "Fix X in file.ts")
   Detected: Broad implementation (e.g., "Implement entire X system")
   
   Review: ${mode} mode should focus on minimal changes.
      `);
    }
  }
}

/**
 * Check if task is over-broad (sounds like full implementation)
 */
function isOverBroadTask(task: Task): boolean {
  const broadKeywords = [
    'implement entire', 'build complete', 'create all',
    'implement', 'create', 'build', 'setup',
    'develop', 'design', 'architect'
  ];
  
  const focusedKeywords = [
    'fix', 'update', 'modify', 'change', 'correct',
    'adjust', 'tweak', 'patch', 'repair'
  ];
  
  const taskText = `${task.name} ${task.description}`.toLowerCase();
  
  const hasBroad = broadKeywords.some(k => taskText.includes(k));
  const hasFocused = focusedKeywords.some(k => taskText.includes(k));
  
  // Over-broad if has broad keywords but no focused keywords
  return hasBroad && !hasFocused;
}

