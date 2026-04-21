import { TASK_PRIORITIES } from "../../state";
import { TaskQueue } from "../../../../types/task";
import { CodeTask } from "../../../../types/task";
import { extractErrorDetails, createErrorViolation } from "../_common/errorHandler";
import { normalizeLanguage, normalizeFramework } from "../../../../../../utils/languageUtils";
import { ARTIFACT_PREFIX, BOUNDARY, type Boundary, type Complexity, type DecidedBy, type SpecClarify } from '@ant/shared';
import { hooksForTaskType } from '../../tasks/_shared/registry';
import { DEFAULT_TASK_TYPE } from '../../tasks/_shared/types';
import { isVerificationTask } from '../../tasks/verification';
import { isErrorTask } from '../../tasks/error';
import { isFeatureTask } from '../../tasks/feature';
import { isUiTask } from '../../tasks/ui/model/is';
import { isDesignSystemTask } from '../../tasks/design-system/model/is';

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
import { flattenPolicyToInclude } from '../../../../../../core/artifact/ArtifactPipeline';

type ArtifactPolicy = { refs?: string[]; context?: string[] };

/**
 * Derive role-annotated artifact selection policy from legacy task fields.
 * Returns undefined for verification tasks (no docs needed).
 */
export function deriveArtifactPolicy(
  taskType: TaskType,
  packages?: string[],
  uiSections?: string[],
  selectedSpec?: string | null,
): ArtifactPolicy | undefined {
  // R1 — phase layer is blind to `task.type`. The predicate helpers below
  // take a `{ type }` shape so this function (which owns only the type
  // string, not the full task object) can still dispatch through the
  // task-bundle SSOT.
  const taskShape = { type: taskType };
  if (isVerificationTask(taskShape)) return undefined;

  if (isUiTask(taskShape) || isDesignSystemTask(taskShape)) {
    const contextPaths: string[] = [];
    if (uiSections?.length) {
      contextPaths.push(`${ARTIFACT_PREFIX.UI}tokens`);
      for (const sec of uiSections) {
        if (sec === 'tokens') continue;
        if (sec === 'assets') contextPaths.push(`${ARTIFACT_PREFIX.UI}assets`);
        else contextPaths.push(`${ARTIFACT_PREFIX.UI_SPEC}${sec}`);
      }
    } else {
      contextPaths.push(`${ARTIFACT_PREFIX.UI}*`);
    }
    return contextPaths.length > 0 ? { context: contextPaths } : undefined;
  }

  const refPaths: string[] = [];
  if (selectedSpec) refPaths.push(`${ARTIFACT_PREFIX.SPEC}${selectedSpec}`);

  if (packages?.length) {
    for (const pkg of packages) {
      if (pkg.startsWith('fe-')) refPaths.push(`${ARTIFACT_PREFIX.FE_SYSTEM}${pkg.slice(3)}.md`);
      else if (pkg.startsWith('be-')) refPaths.push(`${ARTIFACT_PREFIX.BE_SYSTEM}${pkg.slice(3)}.md`);
      else if (pkg === 'shared') refPaths.push(`${ARTIFACT_PREFIX.API_CONTRACT}*`);
    }
    if (!packages.includes('shared')) refPaths.push(`${ARTIFACT_PREFIX.API_CONTRACT}*`);
  }

  return refPaths.length > 0 ? { refs: refPaths } : undefined;
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
  /** 3-way classification: oneshot | exploratory | task. Safe default: 'task'. */
  complexity: Complexity;
  /** 1-sentence rationale for the complexity classification. */
  complexityReason?: string;
  /**
   * Who produced the final `complexity` classification:
   *   - `'llm'`       → LLM emitted a `<complexity>` tag (normal path)
   *   - `'heuristic'` → tag missing / malformed → `normalizeComplexity` fell
   *                     back to `'task'` (still safe, but observable)
   *
   * `'user'` is reserved for future overrule UX; the parser never produces
   * it because LLM output is machine input. Consumers writing
   * `user_turn_meta` patches MUST forward this value so the UI tier badge
   * and `featureBiases` sample can distinguish LLM judgements from
   * degraded fallbacks.
   */
  complexityDecidedBy: DecidedBy;
  /** Hints consumed by the `direct` node when complexity is oneshot/exploratory. */
  directHints?: { targetFiles?: string[]; explorationScope?: string };
  /** Design-redirect choice when todo requires spec that is missing (see SpecClarify). */
  specClarify?: SpecClarify;
}

/**
 * Strict narrow for Complexity. Unknown strings fall back to 'task'.
 *
 * Legacy literal `'todo'` (pre-5-tier rename) is accepted as an alias of
 * `'task'` so LLM outputs quoting the old literal (e.g. from cached few-shots
 * or older prompt revisions) still parse cleanly.
 */
function normalizeComplexity(raw: string | undefined): Complexity {
  const v = (raw || '').trim().toLowerCase();
  if (v === 'oneshot' || v === 'exploratory' || v === 'task') return v;
  if (v === 'todo') return 'task';
  return 'task';
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

    // Complexity classification (session redesign 5-tier model)
    const complexityMatch = rawResponse.match(/<complexity>\s*([\s\S]*?)\s*<\/complexity>/i);
    const complexity = normalizeComplexity(complexityMatch?.[1]);
    // `decidedBy` tracks whether the classification came from the LLM's
    // `<complexity>` tag or from the heuristic fallback. Consumers
    // (user_turn_meta writer, §19 featureBiases sample, future overrule UX)
    // rely on this distinction to audit classification quality.
    const complexityDecidedBy: DecidedBy = complexityMatch ? 'llm' : 'heuristic';
    if (!complexityMatch) {
      console.warn('⚠️  [Decompose] No <complexity> tag found — defaulting to "task"');
    } else {
      console.log(`🧭 [Decompose] Complexity: ${complexity}`);
    }

    let complexityReason: string | undefined;
    const reasonMatch = rawResponse.match(/<complexityReason>\s*([\s\S]*?)\s*<\/complexityReason>/i);
    if (reasonMatch) {
      const r = reasonMatch[1].trim();
      if (r) complexityReason = r;
    }

    let directHints: { targetFiles?: string[]; explorationScope?: string } | undefined;
    const directHintsMatch = rawResponse.match(/<directHints>\s*([\s\S]*?)\s*<\/directHints>/i);
    if (directHintsMatch) {
      const body = directHintsMatch[1].trim();
      if (body && body !== '{}') {
        try {
          const parsedHints = JSON.parse(sanitizeJsonControlChars(body));
          const targetFiles = Array.isArray(parsedHints?.targetFiles)
            ? parsedHints.targetFiles.filter((f: unknown) => typeof f === 'string' && f.length > 0)
            : undefined;
          const explorationScope = typeof parsedHints?.explorationScope === 'string' && parsedHints.explorationScope.trim().length > 0
            ? parsedHints.explorationScope.trim()
            : undefined;
          if (targetFiles?.length || explorationScope) {
            directHints = { targetFiles, explorationScope };
          }
        } catch (error) {
          console.warn('⚠️  [Decompose] Failed to parse <directHints> tag content:', error);
        }
      }
    }

    let specClarify: SpecClarify | undefined;
    const specClarifyMatch = rawResponse.match(/<specClarify>\s*([\s\S]*?)\s*<\/specClarify>/i);
    if (specClarifyMatch) {
      const body = specClarifyMatch[1].trim();
      if (body && body !== '{}' && body.toLowerCase() !== 'null') {
        try {
          const parsed = JSON.parse(sanitizeJsonControlChars(body));
          if (parsed && parsed.needsChoice === true
            && parsed.choiceOptions?.positive?.action
            && parsed.choiceOptions?.neutral?.action
            && parsed.choiceOptions?.negative?.action
          ) {
            specClarify = parsed as SpecClarify;
            console.log('📝 [Decompose] specClarify requested by LLM');
          } else {
            console.warn('⚠️  [Decompose] <specClarify> missing required fields, ignoring');
          }
        } catch (error) {
          console.warn('⚠️  [Decompose] Failed to parse <specClarify> tag content:', error);
        }
      }
    }

    return {
      tasks,
      referenceRequests,
      techTier,
      selectedSpec,
      unknownPackages,
      boundary,
      complexity,
      complexityReason,
      complexityDecidedBy,
      directHints,
      specClarify,
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
    isFeatureTask(task) && task.priority !== TASK_PRIORITIES.FINAL_VERIFICATION
  );
  // Queue composed entirely of verification / error tasks — no feature
  // work to validate. A separate Final Verification is redundant because
  // verification tasks self-validate (they are the gate) and error tasks
  // are remediation fixes targeted at an existing verification failure.
  // `isVerificationTask` already absorbs the FINAL_VERIFICATION priority
  // band, so no separate priority check is needed.
  const allTasksAreRemediation = tasks.length > 0 && tasks.every(task =>
    isVerificationTask(task) || isErrorTask(task)
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
  if (!hasFinalTask && allTasksAreRemediation) {
    console.log(`✅ [createTaskQueue] Final task skipped (queue is verification/error only — no feature work to validate)`);
  } else if (hasFinalTask) {
    console.log(`✅ [createTaskQueue] Final Verification task validated (created by LLM)`);
  }
  
  tasks.forEach(task => {
    // Determine exclusive flag:
    // - Explicit from LLM takes precedence
    // - Fallback delegated to tasks/{type}/hooks/decompose.ts → isExclusive
    //   (setup / error / verification = always true; feature = priority===1000;
    //    ui / design-system / test-code / doc have no hook → fall through to false).
    // R1 — the phase layer is blind to task.type; the dispatch registry owns
    // the per-type predicate.
    const isExplicitExclusive = typeof (task as any).exclusive === 'boolean' ? (task as any).exclusive : undefined;
    const isTypeExclusive =
      hooksForTaskType(task.type)?.decompose?.isExclusive?.(task) ?? false;
    const exclusive = isExplicitExclusive ?? isTypeExclusive;
    
    // parallelGroup only applies when not exclusive
    const parallelGroup = !exclusive && typeof (task as any).parallelGroup === 'string' 
      ? (task as any).parallelGroup 
      : undefined;
    
    // Determine task type: final verification tasks are always 'verification'.
    // When the decompose LLM omits `type`, fall back to the canonical default
    // declared by `tasks/_shared/types.ts` (`DEFAULT_TASK_TYPE = 'feature'`)
    // so the literal lives in exactly one place (R1-compliant).
    const resolvedType = task.priority === TASK_PRIORITIES.FINAL_VERIFICATION
      ? 'verification' as const
      : (task.type || DEFAULT_TASK_TYPE);

    const uiSections: string[] | undefined = Array.isArray((task as any).uiSections) ? (task as any).uiSections : undefined;
    const packages: string[] | undefined = Array.isArray((task as any).packages) ? (task as any).packages : undefined;

    // artifactPolicy: role-annotated selection; include: flat backward-compat projection
    const explicitInclude: string[] | undefined = Array.isArray((task as any).include) ? (task as any).include : undefined;
    const artifactPolicy = deriveArtifactPolicy(resolvedType, packages, uiSections, selectedSpec);
    const include = explicitInclude ?? flattenPolicyToInclude(artifactPolicy);

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
      artifactPolicy,
      exclusive: exclusive || undefined,
      parallelGroup,
    };
    
    taskQueue.push(normalizedTask);

    if (isFeatureTask(normalizedTask)) {
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

  // Count task types via task.type as a generic key (R1 — no `task.type === '...'`
  // literal comparisons). FINAL_VERIFICATION alias re-routes feature→verification
  // so historical decompositions that set priority=1000 without retype still
  // show up under the correct bucket.
  const countByType: Record<string, number> = {};
  for (const t of tasks) {
    const bucket = t.priority === TASK_PRIORITIES.FINAL_VERIFICATION ? 'verification' : (t.type as string);
    countByType[bucket] = (countByType[bucket] ?? 0) + 1;
  }

  console.log(`   Total tasks: ${tasks.length}`);
  console.log(`   Setup: ${countByType.setup ?? 0}`);
  if (countByType['design-system']) console.log(`   Design-System: ${countByType['design-system']}`);
  console.log(`   Feature: ${countByType.feature ?? 0}`);
  if (countByType.ui) console.log(`   UI: ${countByType.ui}`);
  console.log(`   Test-Code: ${countByType['test-code'] ?? 0}`);
  console.log(`   Error: ${countByType.error ?? 0}`);
  console.log(`   Verification: ${countByType.verification ?? 0}`);
  
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

