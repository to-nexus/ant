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

  // 4. Default logic
  // If existing code but no git changes → new feature (generate)
  // If no existing code → new project (generate)
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

  // 2. Check for "refactor" keywords
  const refactorKeywords = [
    'refactor', 'restructure', 'reorganize', 'clean up', 'improve structure',
    'migrate', 'update all', 'change all', 'rename all', 'move all'
  ];
  if (refactorKeywords.some(kw => lower.includes(kw))) {
    return 'refactor';
  }

  // 3. Default: generate
  return 'generate';
}
