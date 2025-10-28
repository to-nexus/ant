import { CodeMode } from "./types";

/**
 * Infer code mode from directive content
 * 
 * Analyzes directive text to determine the intended mode:
 * - generate: Creating new features/files
 * - edit: Modifying existing code
 * - refactor: Improving structure without changing behavior
 * - explain: Analyzing/documenting code
 */
export function inferCodeMode(directive?: string, hasOriginalFiles?: boolean): CodeMode {
  if (!directive) {
    // No directive: default based on whether we have original files
    return hasOriginalFiles ? 'edit' : 'generate';
  }

  const lowerDirective = directive.toLowerCase();

  // Explain/Analyze keywords (highest priority)
  const explainKeywords = [
    'explain',
    'analyze',
    'analyse',
    'describe',
    'what does',
    'how does',
    'why does',
    'document',
    'review'
  ];

  // Refactoring keywords
  const refactorKeywords = [
    'refactor',
    'restructure',
    'improve structure',
    'clean up',
    'cleanup',
    'organize',
    'simplify',
    'optimize structure'
  ];

  // Generate keywords
  const generateKeywords = [
    'create',
    'add new',
    'implement',
    'build',
    'generate',
    'new feature'
  ];

  // Check for explain mode
  if (explainKeywords.some(kw => lowerDirective.includes(kw))) {
    return 'explain';
  }

  // Check for refactor mode
  if (refactorKeywords.some(kw => lowerDirective.includes(kw))) {
    return 'refactor';
  }

  // Check for generate mode
  if (generateKeywords.some(kw => lowerDirective.includes(kw))) {
    return 'generate';
  }

  // Default: edit if we have original files, generate otherwise
  return hasOriginalFiles ? 'edit' : 'generate';
}

