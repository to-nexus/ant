import { TaskQueue, TASK_PRIORITIES } from "../../state";
import { CodeTask } from "../../../../types/task";
import { extractErrorDetails, createErrorViolation } from "../shared/errorHandler";
import { normalizeLanguage, normalizeFramework } from "../../../../../../utils/languageUtils";
import { ARTIFACT_PREFIX, BOUNDARY, type Boundary } from '@ant/shared';

/**
 * Escape unescaped control characters inside JSON string literals.
 * Matches quoted strings (handling escaped chars), then replaces
 * raw 0x00–0x1F bytes within them with proper JSON escape sequences.
 */
function sanitizeJsonControlChars(jsonStr: string): string {
  return jsonStr.replace(/"(?:[^"\\]|\\.)*"/g, (match) => {
    return match.replace(/[\x00-\x1f]/g, (ch) => {
      switch (ch) {
        case '\n': return '\\n';
        case '\r': return '\\r';
        case '\t': return '\\t';
        case '\b': return '\\b';
        case '\f': return '\\f';
        default: {
          const code = ch.charCodeAt(0).toString(16).padStart(4, '0');
          return `\\u${code}`;
        }
      }
    });
  });
}

import type { PackageTierEntry, TaskType } from '@ant/shared';

/**
 * Derive `include` artifact path prefixes from legacy task fields.
 * Backward-compatible fallback when the LLM does not output `include` explicitly.
 */
function deriveIncludeFromLegacyFields(
  taskType: TaskType,
  packages?: string[],
  uiSections?: string[],
  selectedSpec?: string | null,
): string[] | undefined {
  if (taskType === 'verification') return undefined;

  const paths: string[] = [];

  if (taskType === 'ui' || taskType === 'design-system') {
    if (uiSections?.length) {
      paths.push(`${ARTIFACT_PREFIX.UI}tokens`);
      for (const sec of uiSections) {
        if (sec === 'tokens') continue;
        if (sec === 'assets') {
          paths.push(`${ARTIFACT_PREFIX.UI}assets`);
        } else {
          paths.push(`${ARTIFACT_PREFIX.UI_SPEC}${sec}`);
        }
      }
    } else {
      paths.push(`${ARTIFACT_PREFIX.UI}*`);
    }
    return paths.length > 0 ? paths : undefined;
  }

  if (selectedSpec) {
    paths.push(`${ARTIFACT_PREFIX.SPEC}${selectedSpec}`);
  }

  if (packages?.length) {
    for (const pkg of packages) {
      if (pkg.startsWith('fe-')) {
        paths.push(`${ARTIFACT_PREFIX.FE_SYSTEM}${pkg.slice(3)}.md`);
      } else if (pkg.startsWith('be-')) {
        paths.push(`${ARTIFACT_PREFIX.BE_SYSTEM}${pkg.slice(3)}.md`);
      } else if (pkg === 'shared') {
        paths.push(`${ARTIFACT_PREFIX.API_CONTRACT}*`);
      }
    }
    if (!packages.includes('shared')) {
      paths.push(`${ARTIFACT_PREFIX.API_CONTRACT}*`);
    }
  }

  return paths.length > 0 ? paths : undefined;
}

export interface ParsedTechTier {
  stack: string;
  stackReasoning: string;
  language: string;
  framework?: string | null;
  packageTiers?: Record<string, PackageTierEntry>;
}

export interface ParsedDecomposeResponse {
  tasks: CodeTask[];
  referenceRequests?: Array<{project: string; branch?: string; reason?: string}>;
  techTier?: ParsedTechTier;
  selectedSpec?: string | null;
  unknownPackages?: string[];
  boundary?: Boundary;
}

/**
 * Parse LLM response and extract tasks
 * 
 * Expected format: 
 * <tasks>[...]</tasks>
 * <references>[...]</references>  (optional, can be empty array)
 * 
 * STRICT MODE: No fallback parsing. LLM MUST follow the XML tag format.
 */
export function parseLLMResponse(rawResponse: string): ParsedDecomposeResponse {
  try {
    // ✅ Extract JSON array from <tasks> XML tag (REQUIRED)
    const tasksMatch = rawResponse.match(/<tasks>\s*([\s\S]*?)\s*<\/tasks>/);
    
    if (!tasksMatch) {
      throw new Error('Invalid response: <tasks> tag is required. LLM must follow the prompt format strictly.');
    }
    
    const tasks = JSON.parse(sanitizeJsonControlChars(tasksMatch[1]));
    
    if (!Array.isArray(tasks)) {
      throw new Error('Invalid response: tasks must be an array');
    }
    
    // ✅ Extract techTier from <techTier> tag (stack + language + framework + packageTiers)
    let techTier: ParsedTechTier | undefined;
    const techTierMatch = rawResponse.match(/<techTier>\s*([\s\S]*?)\s*<\/techTier>/);
    
    if (techTierMatch) {
      try {
        const parsed = JSON.parse(sanitizeJsonControlChars(techTierMatch[1]));
        techTier = {
          stack: parsed.stack || 'unknown',
          stackReasoning: parsed.stackReasoning || '',
          language: normalizeLanguage(parsed.language || 'typescript'),
          framework: normalizeFramework(parsed.framework || null),
          packageTiers: parsed.packageTiers || undefined,
        };
      } catch (error) {
        console.warn('⚠️  [Decompose] Failed to parse <techTier> tag content:', error);
        techTier = {
          stack: 'unknown',
          stackReasoning: 'Failed to parse techTier',
          language: 'typescript',
          framework: null,
        };
      }
    } else {
      console.warn('⚠️  [Decompose] No <techTier> tag found, using defaults');
      techTier = {
        stack: 'unknown',
        stackReasoning: 'No techTier tag in response',
        language: 'typescript',
        framework: null,
      };
    }

    // ✅ Extract references from <references> tag (OPTIONAL but must use tag format if present)
    let referenceRequests: Array<{project: string; branch?: string; reason?: string}> | undefined;
    const referencesMatch = rawResponse.match(/<references>\s*([\s\S]*?)\s*<\/references>/);
    
    if (referencesMatch) {
      try {
        const parsed = JSON.parse(sanitizeJsonControlChars(referencesMatch[1]));
        // ✅ Accept empty array (no references)
        if (Array.isArray(parsed)) {
          referenceRequests = parsed.length > 0 ? parsed : undefined;
        } else {
          console.warn('⚠️  [Decompose] <references> tag content is not an array, ignoring');
        }
      } catch (error) {
        console.warn('⚠️  [Decompose] Failed to parse <references> tag content:', error);
      }
    }
    
    // ✅ Extract selectedSpec from <selectedSpec> tag (OPTIONAL)
    let selectedSpec: string | null = null;
    const selectedSpecMatch = rawResponse.match(/<selectedSpec>\s*([\s\S]*?)\s*<\/selectedSpec>/);
    if (selectedSpecMatch) {
      const specValue = selectedSpecMatch[1].trim();
      if (specValue && specValue !== 'null' && specValue !== 'none') {
        selectedSpec = specValue;
        console.log(`📋 [Decompose] Selected spec: ${selectedSpec}`);
      }
    }

    // Extract design-prescribed dependencies from <prescribedDependencies> tag (OPTIONAL)
    // Also accepts legacy <unknownPackages> tag for backward compatibility with cached sessions.
    let unknownPackages: string[] | undefined;
    const prescribedDepsMatch = rawResponse.match(/<prescribedDependencies>\s*([\s\S]*?)\s*<\/prescribedDependencies>/)
      || rawResponse.match(/<unknownPackages>\s*([\s\S]*?)\s*<\/unknownPackages>/);
    if (prescribedDepsMatch) {
      try {
        const parsed = JSON.parse(sanitizeJsonControlChars(prescribedDepsMatch[1]));
        if (Array.isArray(parsed)) {
          unknownPackages = parsed.length > 0 ? parsed.filter((p: unknown) => typeof p === 'string' && p.length > 0) : undefined;
          if (unknownPackages && unknownPackages.length > 0) {
            console.log(`📦 [Decompose] Design-prescribed dependencies extracted: ${unknownPackages.join(', ')}`);
          }
        } else {
          console.warn('⚠️  [Decompose] <prescribedDependencies> tag content is not an array, ignoring');
        }
      } catch (error) {
        console.warn('⚠️  [Decompose] Failed to parse <prescribedDependencies> tag content:', error);
      }
    }

    let boundary: Boundary | undefined;
    const boundaryMatch = rawResponse.match(/<boundary>\s*(heavyweight|lightweight)\s*<\/boundary>/i);
    if (boundaryMatch) {
      boundary = boundaryMatch[1].toLowerCase() as Boundary;
      console.log(`📋 [Decompose] Boundary classification: ${boundary}`);
    }

    return {
      tasks,
      referenceRequests,
      techTier,
      selectedSpec,
      unknownPackages,
      boundary,
    };
    
  } catch (error) {
    console.error('❌ [Decompose] Failed to parse LLM response:', error);
    console.error('Raw response:', rawResponse.substring(0, 500));
    throw error;
  }
}

/**
 * Create task queue from parsed tasks
 * 
 * ⚠️ CRITICAL: Final Verification task rules
 * - Required if there are feature tasks (features don't get individual validation)
 * - Optional if ALL tasks are error tasks:
 *   Decompose may omit verification for error-only jobs.
 *   graph.ts checkTaskStatus() auto-adds final verification after the first error task completes
 *   as a safety net. Error tasks always delegate build verification to verification.
 */
export function createTaskQueue(tasks: CodeTask[], selectedSpec?: string | null): {
  taskQueue: TaskQueue<CodeTask>;
  featureTasks: Map<string, CodeTask>;
} {
  const taskQueue = new TaskQueue<CodeTask>();
  const featureTasks = new Map<string, CodeTask>();
  
  // ✅ Validate Final Verification task conditionally
  const hasFinalTask = tasks.some(task => task.priority === TASK_PRIORITIES.FINAL_VERIFICATION);
  const hasFeatureTasks = tasks.some(task => 
    task.type === 'feature' && task.priority !== TASK_PRIORITIES.FINAL_VERIFICATION
  );
  const allTasksAreErrors = tasks.length > 0 && tasks.every(task => 
    task.type === 'error' || task.type === 'verification' || task.priority === TASK_PRIORITIES.FINAL_VERIFICATION
  );
  
  // Final task is required only if there are feature tasks
  if (!hasFinalTask && hasFeatureTasks) {
    throw new Error(
      '❌ [Decompose] LLM failed to create Final Verification task (priority 1000)!\n' +
      '\n' +
      'Feature tasks detected but no final verification task.\n' +
      'Final task is required when there are feature tasks (they skip individual validation).\n' +
      '\n' +
      'This is a CRITICAL prompt violation. Check decompose prompt compliance.'
    );
  }
  
  // Log decision
  if (!hasFinalTask && allTasksAreErrors) {
    console.log(`✅ [createTaskQueue] Final task skipped (all tasks are error tasks with individual validation)`);
  } else if (hasFinalTask) {
    console.log(`✅ [createTaskQueue] Final Verification task validated (created by LLM)`);
  }
  
  tasks.forEach(task => {
    // Determine exclusive flag:
    // - Explicit from LLM takes precedence
    // - Fallback: setup, error, and final (priority 1000) are always exclusive
    const isExplicitExclusive = typeof (task as any).exclusive === 'boolean' ? (task as any).exclusive : undefined;
    // design-system is NOT exclusive — parallelGroup handles token→wiring ordering
    const isTypeExclusive = task.type === 'setup' || task.type === 'error' || task.type === 'verification' || task.priority === TASK_PRIORITIES.FINAL_VERIFICATION;
    const exclusive = isExplicitExclusive ?? isTypeExclusive;
    
    // parallelGroup only applies when not exclusive
    const parallelGroup = !exclusive && typeof (task as any).parallelGroup === 'string' 
      ? (task as any).parallelGroup 
      : undefined;
    
    // Determine task type: final verification tasks are always 'verification'
    const resolvedType = task.priority === TASK_PRIORITIES.FINAL_VERIFICATION
      ? 'verification' as const
      : (task.type || 'feature');

    const uiSections: string[] | undefined = Array.isArray((task as any).uiSections) ? (task as any).uiSections : undefined;
    const packages: string[] | undefined = Array.isArray((task as any).packages) ? (task as any).packages : undefined;

    // include: LLM-provided artifact path prefixes, or auto-derived fallback
    const explicitInclude: string[] | undefined = Array.isArray((task as any).include) ? (task as any).include : undefined;
    const include = explicitInclude ?? deriveIncludeFromLegacyFields(resolvedType, packages, uiSections, selectedSpec);

    const normalizedTask: CodeTask = {
      id: task.id || `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: task.name,
      type: resolvedType,
      priority: task.priority || TASK_PRIORITIES.FEATURE_NORMAL,
      description: task.description,
      errors: task.errors,
      category: task.category,
      uiSections,
      packages,
      include,
      exclusive: exclusive || undefined,
      parallelGroup,
    };
    
    taskQueue.push(normalizedTask);
    
    if (normalizedTask.type === 'feature') {
      featureTasks.set(normalizedTask.id, normalizedTask);
    }
  });
  
  return { taskQueue, featureTasks };
}

/**
 * Log task breakdown summary
 */
export function logTaskSummary(
  tasks: CodeTask[],
  referenceRequests?: Array<{project: string; branch?: string; reason?: string}>
): void {
  console.log(`\n✅ Task breakdown complete:`);
  
  // Count actual task types
  const tasksByType = {
    setup: tasks.filter(t => t.type === 'setup').length,
    'design-system': tasks.filter(t => t.type === 'design-system').length,
    feature: tasks.filter(t => t.type === 'feature' && t.priority !== TASK_PRIORITIES.FINAL_VERIFICATION).length,
    ui: tasks.filter(t => t.type === 'ui').length,
    'test-code': tasks.filter(t => t.type === 'test-code').length,
    doc: tasks.filter(t => t.type === 'doc').length,
    error: tasks.filter(t => t.type === 'error').length,
    verification: tasks.filter(t => t.type === 'verification' || t.priority === TASK_PRIORITIES.FINAL_VERIFICATION).length,
  };

  console.log(`   Total tasks: ${tasks.length}`);
  console.log(`   Setup: ${tasksByType.setup}`);
  if (tasksByType['design-system']) console.log(`   Design-System: ${tasksByType['design-system']}`);
  console.log(`   Feature: ${tasksByType.feature}`);
  if (tasksByType.ui) console.log(`   UI: ${tasksByType.ui}`);
  console.log(`   Test-Code: ${tasksByType['test-code']}`);
  console.log(`   Error: ${tasksByType.error}`);
  console.log(`   Verification: ${tasksByType.verification}`);
  
  // Parallel execution summary
  const exclusiveTasks = tasks.filter(t => t.exclusive);
  const parallelGroups = new Set(tasks.filter(t => t.parallelGroup).map(t => t.parallelGroup));
  if (exclusiveTasks.length > 0 || parallelGroups.size > 0) {
    console.log(`   🔀 Parallel hints:`);
    console.log(`      Exclusive: ${exclusiveTasks.length} tasks (${exclusiveTasks.map(t => t.id).join(', ')})`);
    console.log(`      Parallel groups: ${parallelGroups.size > 0 ? [...parallelGroups].join(', ') : 'none'}`);
  }
  
  // Log reference requests
  if (referenceRequests && referenceRequests.length > 0) {
    console.log(`\n📚 Reference projects requested:`);
    referenceRequests.forEach(ref => {
      console.log(`   - ${ref.project}${ref.branch ? ` (${ref.branch})` : ''}`);
      if (ref.reason) {
        console.log(`     Reason: ${ref.reason}`);
      }
    });
  }
  
  console.log('');
}

