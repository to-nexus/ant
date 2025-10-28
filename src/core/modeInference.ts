import { CodeMode } from "./types";

/**
 * Mode Inference
 * 
 * Automatically infers code generation mode based on directive content and context.
 * This is a core utility used by the prompt engine.
 */

/**
 * Infer code mode from directive and context
 * 
 * Priority:
 * 1. Explicit keywords in directive
 * 2. Presence of original files
 * 3. Default to 'edit'
 */
export function inferCodeMode(
  directive?: string | null,
  hasOriginalFiles?: boolean
): CodeMode {
  if (!directive) {
    // No directive: assume editing existing code or generating new
    return hasOriginalFiles ? 'edit' : 'generate';
  }

  const lower = directive.toLowerCase();

  // 1. Check for "explain" keywords
  const explainKeywords = [
    'explain', 'describe', 'what does', 'how does', 'why does',
    '설명해', '어떻게', '왜', '무엇을', '어떤'
  ];
  if (explainKeywords.some(kw => lower.includes(kw))) {
    return 'explain';
  }

  // 2. Check for "refactor" keywords
  const refactorKeywords = [
    'refactor', 'restructure', 'reorganize', 'clean up', 'improve structure',
    '리팩토링', '리팩터링', '개선', '정리', '구조 변경'
  ];
  if (refactorKeywords.some(kw => lower.includes(kw))) {
    return 'refactor';
  }

  // 3. Check for "generate" keywords
  const generateKeywords = [
    'create', 'add new', 'implement new', 'build new', 'generate',
    '새로 만들', '새로운', '추가해', '생성'
  ];
  if (generateKeywords.some(kw => lower.includes(kw))) {
    return 'generate';
  }

  // 4. Default: edit (most common case)
  return 'edit';
}
