import { ArchitectGraphState } from "../../state";
import { CodeTask } from "../../../../types/task";

/**
 * Detect if directive contains error-related keywords
 * 
 * ⚠️ CRITICAL: Error = BROKEN existing functionality
 * NOT just "fix" keyword (could be feature improvement)
 */
export function detectErrorInDirective(directive: string | undefined): boolean {
  if (!directive) return false;
  
  // ✅ Strong error indicators (existing functionality is BROKEN)
  const strongErrorKeywords = [
    'broken', 'crash', 'crashing', 'crashed',
    'not working', 'doesn\'t work', 'not displayed', 'doesn\'t display',
    'failing', 'failed to', 'exception', 'error:',
    '안 나오', '안나오', '작동 안', '작동하지 않', '동작 안',
    '깨진', '오류', '에러', '버그'
  ];
  
  // ⚠️ Ambiguous keywords (could be error OR feature)
  // Only treat as error if combined with strong indicators
  const ambiguousKeywords = [
    'fix', 'solve', 'resolve', 'correct',
    '수정', '해결', '고치'
  ];
  
  const lowerDirective = directive.toLowerCase();
  
  // Strong error keyword found → definitely error
  if (strongErrorKeywords.some(keyword => lowerDirective.includes(keyword))) {
    return true;
  }
  
  // Ambiguous keyword found → check context
  if (ambiguousKeywords.some(keyword => lowerDirective.includes(keyword))) {
    // If mentions "add", "implement", "create" → likely feature improvement
    const featureKeywords = ['add', 'implement', 'create', 'new', '추가', '구현', '생성'];
    const hasFeatureIntent = featureKeywords.some(k => lowerDirective.includes(k));
    
    if (hasFeatureIntent) {
      // "Fix by adding X" = feature, not error
      return false;
    }
    
    // "Fix X" without adding new things → likely error
    return true;
  }
  
  return false;
}

/**
 * Validate tasks after decompose to detect over-engineering
 */
export function validateTasks(
  tasks: CodeTask[],
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
function isOverBroadTask(task: CodeTask): boolean {
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

