import { CodeMode } from "./types";

/**
 * Mode Inference
 * 
 * Automatically infers code generation mode based on available context:
 * - Directive (primary)
 * - Design document (secondary)
 * - Git changes (tertiary)
 */
export interface ModeInferenceContext {
  directive?: string | null;
  designDoc?: string | null;
  hasGitChanges?: boolean;
  hasExistingCode?: boolean;
}

/**
 * Infer code mode from available context
 * 
 * Priority:
 * 1. Explicit keywords in directive
 * 2. Keywords in design doc (if no directive)
 * 3. Git changes presence
 * 4. Default based on context
 */
export function inferCodeMode(
  context: string | ModeInferenceContext,
  hasOriginalFiles?: boolean  // Kept for backwards compatibility
): CodeMode {
  // Handle backwards compatibility (single string)
  if (typeof context === 'string' || context === null || context === undefined) {
    return inferFromText(context);
  }

  // New approach: comprehensive context
  const { directive, designDoc, hasGitChanges, hasExistingCode } = context;

  // 1. Check directive first (highest priority)
  if (directive) {
    const modeFromDirective = inferFromText(directive);
    if (modeFromDirective !== 'generate') {
      return modeFromDirective;  // explain or refactor explicitly mentioned
    }
  }

  // 2. Check design doc if no clear directive
  if (!directive && designDoc) {
    const modeFromDesign = inferFromText(designDoc);
    if (modeFromDesign !== 'generate') {
      return modeFromDesign;
    }
  }

  // 3. Use context signals
  // If git changes exist → likely refactor/modification
  if (hasGitChanges) {
    return 'refactor';
  }

  // 4. Default logic based on code presence
  // ✅ CRITICAL: If existing code → modify existing (refactor)
  // This prevents regenerating entire project when fixing bugs
  if (hasExistingCode) {
    console.log('[ModeInference] Existing code detected → refactor mode (modify existing code)');
    return 'refactor';
  }

  // If no existing code → new project (generate)
  console.log('[ModeInference] No existing code → generate mode (create new)');
  return 'generate';
}

/**
 * Infer mode from a single text string
 */
function inferFromText(text?: string | null): CodeMode {
  if (!text) {
    return 'generate';
  }

  const lower = text.toLowerCase();

  // 1. Check for "explain" keywords
  const explainKeywords = [
    'explain', 'describe', 'what does', 'how does', 'why does',
    'analyze', 'show me', 'walk through', 'tell me about'
  ];
  if (explainKeywords.some(kw => lower.includes(kw))) {
    return 'explain';
  }

  // 2. Check for "refactor" keywords (broad modification intent)
  const refactorKeywords = [
    // Explicit refactor
    'refactor', 'restructure', 'reorganize', 'clean up', 'improve structure',
    // Bulk changes
    'migrate', 'update all', 'change all', 'rename all', 'move all',
    // Bug fixes and modifications (✅ NEW)
    'fix', 'bug', 'error', 'issue', 'problem', 'broken',
    'modify', 'change', 'update', 'adjust', 'correct',
    // Korean equivalents
    '수정', '버그', '고치', '에러', '오류', '문제', '변경'
  ];
  if (refactorKeywords.some(kw => lower.includes(kw))) {
    return 'refactor';
  }

  // 3. Default: generate
  return 'generate';
}
