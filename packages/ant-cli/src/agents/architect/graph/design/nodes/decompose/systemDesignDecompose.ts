/**
 * System Design Decompose
 * 
 * LLM-driven task decomposition for system design work
 * (unified, contract-first, MSA-contract-first).
 */

import { DesignGraphState } from "../../state";
import { DesignTask } from "../../../../types/task";
import { TaskQueue } from "../../../../types/task";
import { JobTimingManager } from "../../../../../common/graph/timing/JobTimingManager";
import { LLM_TEMPERATURE, LLM_MAX_TOKENS } from "../../../../../common/graph/llmConfig";
import { ARTIFACT_PREFIX } from '@ant/shared';
import { ArtifactPoolView } from '../../../../../../core/prompt/builder/ArtifactPipeline';
import { updateKanban, createDesignTaskStreamingHook } from "./kanbanUpdate";
import { resolveLLMClient, showChatPlaceholder } from "./llmClient";
import { applyEstimatingUsage } from "../../../../../common/graph/llmHelpers";
import { parseLLMJsonResponse } from "../../utils/jsonResponseParser";
import { safeLogPrompt } from "../../utils/promptLog";
import { saveDecomposeCheckpoint } from "../../session/checkpoint";
import { resolveDesignTargetFiles } from "../../../../../../core/types/detection";
import { BOUNDARY, type Mode, buildTechTier, type Stack, type TechTierConfig, resolveTaskTechTiersFromMap, applyExplicitTechTierOverrides, type PackageTierEntry } from "@ant/shared";
import { parseExecutionTierTag, coerceExecutionTier, recordUserTurnMeta, ExecutionTierId } from "../../../../../../core/executionTier";
import { assignedNotInCatalog, resolveCatalogEntry } from "./catalogLookup";

interface DecomposeContext {
  phaseStart: number;
  newJobId: string;
  newJobTiming: any;
  estimatingStartTime: string;
}

// ============================================
// Response Type
// ============================================

export interface SystemDesignResponse {
  documentType: 'unified' | 'contract-first' | 'msa-contract-first';
  /**
   * Provider — this project's BE service boundaries. Each entry produces
   * BOTH `api-contract-{name}.md` AND `be-system-{name}.md`. Meaningful
   * only for `gen-sys-be` / `gen-sys-full`; ignored for `gen-sys-fe`.
   */
  services?: string[];
  /** Frontend package boundaries. Each entry produces `fe-system-{name}.md`. */
  fePackages?: string[];
  /**
   * Consumer — external API hosts this project consumes (snapshot
   * reference). Each entry produces `api-contract-{name}.md` ONLY; no
   * `be-system-*.md` co-creation. Meaningful in any system-design intent
   * — `gen-sys-fe` expresses pure consumer; `gen-sys-full` /
   * `gen-sys-be` may mix provider and consumer.
   *
   * The downstream code job consumes every `api-contract-*.md` via
   * wildcard inclusion, so provider-vs-consumer authorship is a
   * decompose-prompt concern (See `api-contract-guide.md` "Role"
   * section + "External Contract Discovery"); the schema-level
   * distinction here only drives co-creation rules in
   * `validateAndFixTargetFiles`.
   */
  consumedApis?: string[];
  targetFiles: string[];
  techTier?: { stack: string; language: string; framework?: string };
  packageTiers?: Record<string, PackageTierEntry>;
  tasks: Array<{
    id: string;
    name: string;
    targetFile: string;
    targetService?: string;
    description: string;
    priority: number;
    exclusive?: boolean;
    parallelGroup?: string;
    assignedSections?: string[];
  }>;
  references?: Array<{
    project: string;
    branch?: string;
    reason?: string;
  }>;
}

// ============================================
// System Design File Pattern Recognition
// ============================================

/**
 * Known system design document patterns (unified naming):
 * - api-contract-{name}.md
 * - fe-system-{name}.md
 * - be-system-{name}.md
 */
const SYSTEM_DESIGN_FILE_PATTERNS = [
  /^api-contract-.+\.md$/,
  /^fe-system-.+\.md$/,
  /^be-system-.+\.md$/,
];

function isSystemDesignFile(fileName: string): boolean {
  return SYSTEM_DESIGN_FILE_PATTERNS.some(p => p.test(fileName));
}

/**
 * Strip the matrix-injected path prefix (`architecture/system/`) so the
 * basename — the only token `validateAndFixTargetFiles` recognises — is left
 * intact. Wildcards (`-*.md`) are preserved; the validator collapses or
 * expands them based on the LLM's MSA decision.
 *
 * Pre-`0f9ee7e4` regression: action-config-matrix's `formatOutputSpec` ships
 * `architecture/system/be-system-*.md` into `actionMetadata.target`. Without
 * this strip, downstream strict-equality (`f === 'be-system-main.md'`) sees
 * the full path + wildcard and never matches.
 */
function stripDesignTargetPrefix(file: string): string {
  return file.split('/').pop() ?? file;
}

// ============================================
// Resolved TargetFiles Validation (Single Source of Truth)
// ============================================

/**
 * Validate and fix LLM response against resolvedTargetFiles.
 * Single normalization path for ALL environments and architectures.
 *
 * Flow: MSA expansion → consumedApis expansion → task remap →
 * documentType inference → coverage check.
 *
 * Placeholder semantics (matrix wildcard contract since 0f9ee7e4):
 *   - `*` is a postfix placeholder ("filled by LLM's MSA decision")
 *   - multi-package: response.services / fePackages → per-package postfix
 *   - single-package: collapse to `main`
 *
 * Provider vs Consumer expansion:
 *   - `services` (provider) — BE/Full intent only. Each entry produces
 *     `be-system-{s}.md` AND `api-contract-{s}.md`. Ignored for
 *     `gen-sys-fe` (FE-only projects have no provider boundary).
 *   - `consumedApis` (consumer) — any intent. Each entry produces
 *     `api-contract-{c}.md` ONLY. Seeds an `api-contract-*.md` placeholder
 *     into `resolvedTargetFiles` when the FE-only intent didn't include
 *     one (matrix default for `gen-sys-fe` is `['fe-system-main.md']`).
 *   - `fePackages` — unchanged, expands `fe-system-*.md` per package.
 *
 * MSA expansion accepts both `-main.md` (legacy detect path) and `-*.md`
 * (matrix path) as expansion keys:
 *   be-system-{main,*}.md → be-system-{service}.md  (when response.services exists)
 *   fe-system-{main,*}.md → fe-system-{package}.md  (when response.fePackages exists)
 *   api-contract-{main,*}.md → api-contract-{service-or-consumer}.md
 *
 * Single-package fallback: any wildcard surviving Step 1 collapses to `-main.md`.
 *
 * FE intent defense: `be-system-*.md` survivors stripped after expansion —
 * frontend-only projects never produce backend system docs even if the LLM
 * mistakenly emits them.
 *
 * Provider/Consumer name conflict: when `services` ∩ `consumedApis` is
 * non-empty, the consumer entries are dropped silently with a warning —
 * provider authorship takes precedence (the project owns that name).
 */
export function validateAndFixTargetFiles(
  response: SystemDesignResponse,
  resolvedTargetFiles: string[],
  _detectedEnv: string | undefined,
  jobMode: Mode = 'generate',
  intentId?: string
): SystemDesignResponse {
  const isFE = intentId === 'gen-sys-fe';

  // Step 0: services ∩ consumedApis conflict — provider wins.
  if (response.services?.length && response.consumedApis?.length) {
    const providerSet = new Set(response.services);
    const overlap = response.consumedApis.filter(c => providerSet.has(c));
    if (overlap.length > 0) {
      console.warn(
        `⚠️  [validateAndFixTargetFiles] services ∩ consumedApis = ` +
        `[${overlap.join(', ')}] — consumer entries dropped (provider takes precedence).`
      );
      response.consumedApis = response.consumedApis.filter(c => !providerSet.has(c));
    }
  }

  // Step 1a: services expansion (provider) — BE/Full intent only.
  // Replaces `-main.md` / `-*.md` placeholders with per-service files.
  let effectiveTargetFiles = [...resolvedTargetFiles];

  if (response.services?.length && !isFE) {
    effectiveTargetFiles = effectiveTargetFiles.flatMap(f =>
      f === 'be-system-main.md' || f === 'be-system-*.md'
        ? response.services!.map(s => `be-system-${s}.md`)
        : f === 'api-contract-main.md' || f === 'api-contract-*.md'
          ? response.services!.map(s => `api-contract-${s}.md`)
          : [f]
    );
  }

  // Step 1b: consumedApis expansion (consumer) — any intent.
  //
  // Two paths:
  //   - Placeholder present (FE matrix default OR services-less BE matrix
  //     default): replace placeholder with per-consumer concrete files.
  //   - No placeholder (services already expanded the api-contract slot
  //     into concrete files OR FE intent without any api-contract entry):
  //     append each per-consumer concrete file. De-duplicate against
  //     services-derived names to keep provider authorship intact.
  if (response.consumedApis?.length) {
    const placeholderIdx = effectiveTargetFiles.findIndex(f =>
      f === 'api-contract-main.md' || f === 'api-contract-*.md'
    );
    const consumerFiles = response.consumedApis.map(c => `api-contract-${c}.md`);
    if (placeholderIdx >= 0) {
      effectiveTargetFiles.splice(placeholderIdx, 1, ...consumerFiles);
    } else {
      for (const f of consumerFiles) {
        if (!effectiveTargetFiles.includes(f)) effectiveTargetFiles.push(f);
      }
    }
  }

  if (response.fePackages?.length) {
    effectiveTargetFiles = effectiveTargetFiles.flatMap(f =>
      f === 'fe-system-main.md' || f === 'fe-system-*.md'
        ? response.fePackages!.map(p => `fe-system-${p}.md`)
        : [f]
    );
  }

  // Step 1c: Single-package fallback — wildcards not consumed by expansion
  // collapse to `-main.md`. The downstream strict-equality (Step 2 task
  // filter, Step 5 coverage check) is concrete-filename only.
  effectiveTargetFiles = effectiveTargetFiles.map(f =>
    f.endsWith('-*.md') ? f.replace(/-\*\.md$/, '-main.md') : f
  );

  // Step 1d: FE intent defense — strip any be-system survivors. Frontend
  // projects never own provider boundaries; LLM emissions to the contrary
  // are silently dropped here (matches the frontend prompt guard).
  if (isFE) {
    effectiveTargetFiles = effectiveTargetFiles.filter(f => !f.startsWith('be-system-'));
  }

  // Step 1e: Deduplicate (services and consumedApis can coexist with
  // different names but the api-contract placeholder may have been
  // seeded redundantly).
  effectiveTargetFiles = [...new Set(effectiveTargetFiles)];

  response.targetFiles = effectiveTargetFiles;

  // Step 2: Filter tasks outside resolved targets (drop instead of remap)
  const validFiles = new Set(effectiveTargetFiles);
  const originalTaskCount = response.tasks.length;
  response.tasks = response.tasks.filter(t => {
    if (validFiles.has(t.targetFile)) return true;
    if (t.targetService) {
      const beFile = `be-system-${t.targetService}.md`;
      if (validFiles.has(beFile)) { t.targetFile = beFile; return true; }
      const feFile = `fe-system-${t.targetService}.md`;
      if (validFiles.has(feFile)) { t.targetFile = feFile; return true; }
    }
    return false;
  });
  if (response.tasks.length < originalTaskCount) {
    console.warn(
      `⚠️  [validateAndFixTargetFiles] Filtered ${originalTaskCount - response.tasks.length} task(s) ` +
      `targeting files outside resolved targets [${effectiveTargetFiles.join(', ')}]`
    );
  }

  // Step 3 (refactor only): Narrow targetFiles to only what the LLM chose to modify.
  // In refactor mode the LLM intentionally targets a subset of files — respect that
  // instead of forcing coverage on all resolved files.
  if (jobMode === 'refactor' && response.tasks.length > 0) {
    const llmTargetedFiles = [...new Set(response.tasks.map(t => t.targetFile))];
    if (llmTargetedFiles.length < effectiveTargetFiles.length) {
      console.log(
        `ℹ️  [validateAndFixTargetFiles] Refactor mode: narrowing targetFiles from ` +
        `[${effectiveTargetFiles.join(', ')}] → [${llmTargetedFiles.join(', ')}]`
      );
      effectiveTargetFiles = llmTargetedFiles;
      response.targetFiles = effectiveTargetFiles;
    }
  }

  // Step 4: documentType inference
  const hasMSA = (response.services?.length ?? 0) > 0 || (response.fePackages?.length ?? 0) > 0;
  const hasApiContract = effectiveTargetFiles.some(f => f.startsWith('api-contract-'));
  if (hasMSA) {
    response.documentType = 'msa-contract-first';
  } else if (effectiveTargetFiles.length === 1 && !hasApiContract) {
    response.documentType = 'unified';
  } else if (hasApiContract) {
    response.documentType = 'contract-first';
  }

  // Step 5: Coverage check — generate mode only.
  // In refactor mode, Step 3 already narrowed targetFiles to the LLM's selection,
  // so forcing tasks for uncovered files would re-introduce the files we just trimmed.
  if (jobMode !== 'refactor') {
    const coveredFiles = new Set(response.tasks.map(t => t.targetFile));
    const uncovered = effectiveTargetFiles.filter(f => !coveredFiles.has(f));
    if (uncovered.length > 0) {
      response.tasks.push(...generateMinimumTasks(uncovered));
    }
  }

  return response;
}

// ============================================
// Validation & Recovery
// ============================================

/**
 * Universal validation: every targetFile must have at least one task with that targetFile.
 */
function validateTaskCoverage(response: SystemDesignResponse): { valid: boolean; uncovered: string[] } {
  const coveredFiles = new Set(response.tasks.map(t => t.targetFile));
  const uncovered = response.targetFiles.filter(f => !coveredFiles.has(f));
  return { valid: uncovered.length === 0, uncovered };
}

/**
 * A single task's assignedSections-vs-catalog mismatch.
 *
 * The catalog is selected by `targetFile` prefix
 * (`fe-system-` / `be-system-` / `api-contract-`); when the prefix is
 * unknown or the catalog template can't be loaded, validation is skipped
 * (the task is treated as conforming) — see `assignedNotInCatalog`.
 */
export interface AssignedSectionsViolation {
  taskId: string;
  targetFile: string;
  mismatched: string[];
}

/**
 * Cross-check every task's `assignedSections` against the catalog implied
 * by its `targetFile` prefix. Tasks without `assignedSections` are skipped
 * (the field is optional in legacy responses); tasks whose `targetFile`
 * doesn't match a known prefix are also skipped (no catalog to compare
 * against).
 *
 * The returned list is empty when every task is consistent. Callers in
 * `parseAndValidate` throw on a non-empty list so the existing repair-call
 * loop kicks in with a precise error message naming the offending task(s)
 * and the bad section names.
 *
 * Without this validator, decompose can hand a task like
 * `targetFile: "api-contract-main.md"` together with `assignedSections`
 * drawn from the frontend catalog. The execute LLM then receives a
 * prompt where ASSIGNED sections, FORBIDDEN sections, and the filtered
 * catalog all disagree, producing a hallucinated output filename
 * (e.g. `fe-system-main.md`) and the actual contract document goes
 * missing — the exact regression this guard exists to prevent.
 */
export async function validateAssignedSectionsAgainstCatalogs(
  response: SystemDesignResponse,
): Promise<AssignedSectionsViolation[]> {
  const violations: AssignedSectionsViolation[] = [];

  for (const task of response.tasks) {
    const sections = task.assignedSections;
    if (!sections || sections.length === 0) continue;
    if (!resolveCatalogEntry(task.targetFile)) continue;

    const mismatched = await assignedNotInCatalog(task.targetFile, sections);
    if (mismatched.length > 0) {
      violations.push({
        taskId: task.id,
        targetFile: task.targetFile,
        mismatched,
      });
    }
  }

  return violations;
}

/**
 * Format an `AssignedSectionsViolation[]` into a single error message
 * suitable for the repair-call feedback loop. The message is parsed by
 * humans only — the LLM repair prompt re-emits the contract from the
 * original prompt, not from this string.
 */
export function formatAssignedSectionsViolations(
  violations: AssignedSectionsViolation[],
): string {
  return (
    `assignedSections do not match the catalog implied by targetFile: ` +
    violations
      .map(
        v =>
          `${v.taskId}(targetFile=${v.targetFile}) has sections [${v.mismatched.join(
            ', ',
          )}] which are NOT in the ${v.targetFile.split('-').slice(0, 2).join('-')} catalog`,
      )
      .join('; ') +
    `. Each task's assignedSections MUST come from the catalog whose prefix matches its targetFile ` +
    `(api-contract-* uses api-contract-catalog-names.md; fe-system-* uses frontend-catalog-names.md; ` +
    `be-system-* uses backend-catalog-names.md).`
  );
}

/**
 * Generate minimum viable tasks from targetFiles.
 * Each targetFile gets exactly one task with parallelGroup set to baseName.
 */
function generateMinimumTasks(targetFiles: string[]): SystemDesignResponse['tasks'] {
  return targetFiles.map((file, idx) => {
    const baseName = file.replace('.md', '');
    return {
      id: `design-${baseName}`,
      name: `Design Document: ${baseName}`,
      targetFile: file,
      priority: 200 + idx * 20,
      description: `Generate ${file} design document based on requirements.`,
      parallelGroup: baseName,
    };
  });
}

// ============================================
// Profile Resolution
// ============================================

/**
 * Convert a design targetFile to a normalized tag using Code Job `packages` convention.
 * e.g. "be-system-auth.md" → "be-auth", "api-contract-main.md" → "be-main"
 */
function targetFileToTag(targetFile: string): string | undefined {
  const match = targetFile.match(/^(be-system|fe-system|api-contract)-(.+)\.md$/);
  if (!match) return undefined;
  const [, prefix, name] = match;
  const tier = prefix === 'fe-system' ? 'fe' : 'be';
  return `${tier}-${name}`;
}

// ============================================
// Task Queue Population
// ============================================

function buildTaskQueue(
  response: SystemDesignResponse,
  sourceFileNames: string[] = [],
  basisTechTierConfig: TechTierConfig,
  explicitTechTier: TechTierConfig | undefined,
): TaskQueue<DesignTask> {
  const taskQueue = new TaskQueue<DesignTask>();
  
  // Pre-compute isLastTaskForDocument per targetFile group
  const tasksByFile = new Map<string, typeof response.tasks>();
  for (const taskData of response.tasks) {
    const file = taskData.targetFile;
    if (!tasksByFile.has(file)) tasksByFile.set(file, []);
    tasksByFile.get(file)!.push(taskData);
  }
  const lastTaskIdPerFile = new Set<string>();
  for (const tasks of tasksByFile.values()) {
    const sorted = [...tasks].sort((a, b) => (a.priority || 250) - (b.priority || 250));
    if (sorted.length > 0) lastTaskIdPerFile.add(sorted[sorted.length - 1].id);
  }

  // consumedApis-derived api-contract files capture an EXTERNAL contract
  // — they are not authored by this project and must NOT contribute to
  // this project's techTier resolution. The `targetFileToTag` mapping
  // (`api-contract-{s}.md → be-{s}`) would otherwise inject a phantom
  // backend tier hint into `resolveTaskTechTiersFromMap`.
  const consumerApiContractFiles = new Set(
    (response.consumedApis ?? []).map(c => `api-contract-${c}.md`)
  );

  for (const taskData of response.tasks) {
    if (!response.targetFiles.includes(taskData.targetFile)) {
      taskData.targetFile = response.targetFiles[0];
    }
    
    const exclusive = typeof taskData.exclusive === 'boolean' ? taskData.exclusive : undefined;
    const parallelGroup = !exclusive && typeof taskData.parallelGroup === 'string'
      ? taskData.parallelGroup
      : undefined;
    
    const isConsumerContract = consumerApiContractFiles.has(taskData.targetFile);
    const tag = isConsumerContract ? undefined : targetFileToTag(taskData.targetFile);
    const packages = tag ? [tag] : undefined;
    const resolvedTiers = resolveTaskTechTiersFromMap(packages, basisTechTierConfig, response.packageTiers);
    const taskTechTiers = applyExplicitTechTierOverrides(resolvedTiers, explicitTechTier);

    taskQueue.push({
      id: taskData.id,
      name: taskData.name,
      type: 'doc',
      priority: taskData.priority || 250,
      description: taskData.description,
      targetFile: taskData.targetFile,
      targetService: taskData.targetService,
      assignedSections: taskData.assignedSections,
      sourceFiles: Array.isArray((taskData as any).sourceFiles) ? (taskData as any).sourceFiles : undefined,
      include: [ARTIFACT_PREFIX.SOURCES],
      artifactPolicy: {
        refs: [ARTIFACT_PREFIX.SOURCES],
      },
      isLastTaskForDocument: lastTaskIdPerFile.has(taskData.id),
      packages,
      techTiers: taskTechTiers,
      exclusive: exclusive || undefined,
      parallelGroup,
      completed: false
    } as DesignTask);
  }

  if (sourceFileNames.length > 0) {
    for (const task of taskQueue.getAll()) {
      if (!task.sourceFiles || task.sourceFiles.length === 0) {
        console.warn(`⚠️ [Decompose] task "${task.id}" missing sourceFiles`);
      }
    }
  }

  if (response.packageTiers && Object.keys(response.packageTiers).length > 0) {
    const tierSummary = taskQueue.getAll()
      .filter(t => t.techTiers?.length)
      .map(t => `${t.id}→${t.techTiers!.map(tier => `${tier.language}${tier.framework ? `/${tier.framework}` : ''}`).join('+')}`)
      .join(', ');
    console.log(`🔧 [Decompose] TechTiers resolved: ${tierSummary || 'none'}`);
  }
  
  return taskQueue;
}

// ============================================
// Main Export
// ============================================

/**
 * Handle system design decomposition via LLM.
 */
export async function decomposeSystemDesign(
  state: DesignGraphState,
  ctx: DecomposeContext
): Promise<DesignGraphState> {
  const {
    DECOMPOSE_SOURCE_THRESHOLD,
    READ_SOURCE_DOC_TOOL,
    handleReadSourceFile,
  } = await import('../docGen/sourceSelector');
  const { callLLMWithToolLoop } = await import('../../../../../common/llm/callLLMWithToolLoop');
  const { buildDecomposeContext } = await import('./buildDecomposeContext');

  const pool = new ArtifactPoolView(state.artifacts || []);
  const sourceRecord = pool.sourcesAsRecord();

  // Role-aware partition of the RAC-derived pool. Replaces the legacy
  // `spec` variable that flattened sources/previous-design/directive
  // into a single string and discarded the role provenance assigned by
  // `loadResolvedArtifacts` upstream.
  const decomposeCtx = buildDecomposeContext(pool, state, {
    includePreviousDesign: true,
    toolModeThreshold: DECOMPOSE_SOURCE_THRESHOLD,
  });
  const useToolMode = decomposeCtx.meta.sourcesMode === 'tool';
  console.log(
    `📊 [SystemDecompose] sourcesMode=${decomposeCtx.meta.sourcesMode}, ` +
    `refSize=${decomposeCtx.meta.refSize.toLocaleString()}, ` +
    `contextSize=${decomposeCtx.meta.contextSize.toLocaleString()}, ` +
    `threshold=${DECOMPOSE_SOURCE_THRESHOLD.toLocaleString()}`,
  );

  // Extract existing system design file names (pattern-filtered, not all .md).
  // Used as a refactor-mode filename constraint only — the document CONTENT
  // is already injected via role-annotated pool sections (ArtifactPipeline),
  // so no separate "existing design preview" block is needed here.
  const existingDesignFiles = state.existingDesignDocs
    ? Object.keys(state.existingDesignDocs).filter(isSystemDesignFile)
    : [];
  const jobMode = state.resolvedAction?.mode || 'generate';
  // Matrix wildcard contract (`0f9ee7e4`+): `state.resolvedAction.target` arrives as
  // `architecture/system/be-system-*.md`. Strip the prefix so basename-only
  // comparisons in `validateAndFixTargetFiles` work; wildcards stay intact and
  // the validator decides between MSA expansion vs `-main.md` collapse.
  const resolvedTargetFiles = state.resolvedAction?.target?.map(stripDesignTargetPrefix);
  const detectedEnv: Stack = state.resolvedAction?.intent?.includes('-fe') ? 'frontend' : state.resolvedAction?.intent?.includes('-be') ? 'backend' : 'fullstack';

  // For prompt: use resolvedTargetFiles as the authority for file constraints
  const promptExistingFiles = jobMode === 'refactor'
    ? (resolvedTargetFiles || (existingDesignFiles.length > 0 ? existingDesignFiles : undefined))
    : (existingDesignFiles.length > 0 ? existingDesignFiles : undefined);
  const promptPrimaryFile = resolvedTargetFiles?.[0]
    || (existingDesignFiles.length > 0 ? existingDesignFiles[0] : 'be-system-main.md');

  const sourceFileNames = pool.sourceFileNames();

  // Render prompt
  const FilePromptAdapter = await import('../../../../../../periphery/adapters/prompt/FilePromptAdapter');
  const promptAdapter = new FilePromptAdapter.FilePromptAdapter();
  const prompt = await promptAdapter.render('jobs/design/nodes/decompose/variants/system-design/base', {
    documentName: decomposeCtx.documentName,
    refs: decomposeCtx.refs,
    context: decomposeCtx.context,
    directive: decomposeCtx.directive,
    detectedMode: jobMode,
    existingDesignFiles: promptExistingFiles,
    primaryDesignFile: promptPrimaryFile,
    environment: detectedEnv,
    resolvedTargetFiles,
    sourceFileNames: sourceFileNames.length > 0 ? sourceFileNames : undefined,
  });

  await safeLogPrompt(
    state.context.featurePath,
    state.jobId || state._httpJobId || 'unknown',
    'decompose-systemDesign',
    prompt.length,
    {
      templatePath: 'jobs/design/nodes/decompose/variants/system-design/base',
      usedTemplates: [
        'jobs/design/nodes/decompose/variants/system-design/rules',
        'jobs/design/nodes/decompose/shared/input-context',
      ],
      injectedVariables: {
        documentName: decomposeCtx.documentName,
        sourcesMode: decomposeCtx.meta.sourcesMode,
        refSize: decomposeCtx.meta.refSize,
        contextSize: decomposeCtx.meta.contextSize,
        hasSystemDesignRef: pool.hasSystemDesignRef(),
        environment: detectedEnv,
        resolvedTargetFiles,
        useToolMode,
      },
    }
  );

  await showChatPlaceholder();
  const maybeLlm = await resolveLLMClient(state);
  if (!maybeLlm) throw new Error('LLM client not available');
  const llmToUse = maybeLlm;

  // Per-flow decompose call index (main + repair share this counter so
  // token debug log entries are ordered 0 → 1 → 2 ... within one job.)
  let callIdx = 0;

  // Streaming Kanban hook — surfaces each `<task>` JSON as it streams
  // out of the tool loop. The repair-call path below clears the
  // accumulator before re-streaming so failed-attempt leftovers do not
  // stack on top of the repaired response.
  const streamingHook = createDesignTaskStreamingHook(state);

  /**
   * Call LLM to get raw text response.
   *
   * Both tool-mode (RAG) and inline-mode go through `callLLMWithToolLoop`.
   * In inline-mode the tool list is empty so the loop terminates after a
   * single streamed round. The shared path guarantees the streaming Kanban
   * hook fires regardless of source size — previously the inline branch
   * used `invokeWithUsage` (single-shot) and `<task>` wrappers never
   * reached `XMLStreamParser`, so the todo column always landed in one
   * burst at the end.
   */
  async function callLLM(): Promise<string> {
    const tools = useToolMode && pool.hasSources() ? [READ_SOURCE_DOC_TOOL] : [];
    const { response, usage } = await callLLMWithToolLoop(
      llmToUse,
      [{ role: 'user', content: prompt }],
      tools,
      (name, args) => {
        if (name === 'read_source_doc') {
          return handleReadSourceFile(args.filename, sourceRecord, args.startLine, args.endLine);
        }
        return `Error: Unknown tool "${name}"`;
      },
      {
        temperature: LLM_TEMPERATURE.DECOMPOSE,
        maxTokens: LLM_MAX_TOKENS.DEFAULT,
        enableThinking: true,
        thinkingBudget: 10000,
        state: state as any,
        onTaskParsed: streamingHook.onTaskParsed,
      },
    );
    applyEstimatingUsage(state, 'decompose', usage, { subNode: 'system', callIndex: callIdx++, promptChars: prompt.length });
    return response;
  }

  /**
   * Parse raw LLM response → normalize against resolved targets → validate coverage.
   *
   * Async because `validateAssignedSectionsAgainstCatalogs` reads catalog
   * template files. Throwing here funnels the error into the existing
   * repair-call branch (`repairCall` below) so the LLM gets a precise
   * mismatch description to correct on its second attempt.
   */
  async function parseAndValidate(textResponse: string): Promise<SystemDesignResponse> {
    const parsedResponse = parseLLMJsonResponse(textResponse);
    let response: SystemDesignResponse;

    if (parsedResponse.documentType && parsedResponse.targetFiles && parsedResponse.tasks) {
      response = parsedResponse;
    } else if (parsedResponse.tasks) {
      response = {
        documentType: 'unified',
        targetFiles: ['be-system-main.md'],
        ...(parsedResponse.profiles && { profiles: parsedResponse.profiles }),
        tasks: parsedResponse.tasks.map((task: any) => ({
          ...task,
          targetFile: task.targetFile || 'be-system-main.md'
        }))
      };
    } else {
      throw new Error('Invalid task breakdown format from LLM');
    }

    const intentId = state.resolvedAction?.intent || 'gen-sys-full';
    const effectiveResolvedFiles = resolvedTargetFiles
      || resolveDesignTargetFiles(intentId, jobMode as Mode, existingDesignFiles).targetFiles;
    response = validateAndFixTargetFiles(response, effectiveResolvedFiles, detectedEnv, jobMode as Mode, intentId);

    const { valid, uncovered } = validateTaskCoverage(response);
    if (!valid) {
      throw new Error(`Task coverage incomplete: no tasks for [${uncovered.join(', ')}]`);
    }

    // Step 2.5 (post-coverage): assignedSections × targetFile-catalog match.
    // Has to run AFTER `validateAndFixTargetFiles` because that step may
    // remap/expand `targetFile`s (MSA, consumedApis) — only the final
    // post-normalization filename has a canonical catalog to validate
    // against.
    const sectionViolations = await validateAssignedSectionsAgainstCatalogs(response);
    if (sectionViolations.length > 0) {
      throw new Error(formatAssignedSectionsViolations(sectionViolations));
    }

    return response;
  }

  /**
   * Repair call: send raw response + error feedback back to LLM for
   * contract correction. Streams through `callLLMWithToolLoop` (no
   * tools) so the Kanban hook fills task-by-task during the repaired
   * pass too.
   */
  async function repairCall(rawResponse: string, errorMessage: string): Promise<string> {
    const truncated = rawResponse.length > 4000
      ? rawResponse.slice(0, 4000) + '\n...[truncated]'
      : rawResponse;

    const repairMessages = [
      { role: 'user' as const, content: prompt },
      { role: 'assistant' as const, content: truncated },
      { role: 'user' as const, content:
        `Your previous response did not match the required contract.\n\n` +
        `Error: ${errorMessage}\n\n` +
        `Re-emit the response strictly in the contract from the original prompt:\n` +
        `  1. Meta tags first, one per line, JSON-encoded body\n` +
        `     (\`<executionTier>\`, \`<documentType>\`, \`<services>\`, \`<fePackages>\`,\n` +
        `      \`<consumedApis>\`, \`<techTier>\`, \`<packageTiers>\`, \`<targetFiles>\`).\n` +
        `  2. Then a \`<tasks>\` block with one \`<task>{json}</task>\` per task.\n` +
        `NO markdown fences. NO \`<decompose>\` wrapper. Output the contract only — no other prose.`
      },
    ];

    const { response, usage } = await callLLMWithToolLoop(
      llmToUse,
      repairMessages,
      [],
      () => `Error: tools are not available in repair mode`,
      {
        temperature: LLM_TEMPERATURE.DECOMPOSE,
        maxTokens: LLM_MAX_TOKENS.DEFAULT,
        enableThinking: true,
        thinkingBudget: 10000,
        state: state as any,
        onTaskParsed: streamingHook.onTaskParsed,
      },
    );
    applyEstimatingUsage(state, 'decompose', usage, { subNode: 'system-repair', callIndex: callIdx++, promptChars: prompt.length });
    return response;
  }

  // ━━━ Main flow: LLM call → parse → repair if needed → fail if all fail ━━━
  let response: SystemDesignResponse | null = null;
  let lastError: Error | null = null;

  let rawResponse: string | undefined;
  try {
    rawResponse = await callLLM();
  } catch (error) {
    lastError = error as Error;
    console.error(`❌ [SystemDecompose] LLM call failed: ${lastError.message}`);
  }

  if (rawResponse) {
    try {
      response = await parseAndValidate(rawResponse);
    } catch (parseError) {
      lastError = parseError as Error;
      console.warn(`⚠️  [SystemDecompose] Parse failed: ${lastError.message}. Sending repair call...`);

      // Drop any partial tasks streamed from the failed attempt so the
      // repaired response builds the Kanban from a clean slate. The
      // repair path itself is single-shot (invokeWithUsage) and does
      // not stream, but `parseAndValidate(repairedRaw)` will broadcast
      // the final task list synchronously via the regular pipeline.
      streamingHook.reset();

      try {
        const repairedRaw = await repairCall(rawResponse, lastError.message);
        response = await parseAndValidate(repairedRaw);
      } catch (repairError) {
        lastError = repairError as Error;
        console.error(`❌ [SystemDecompose] Repair call also failed: ${lastError.message}`);
      }
    }
  }

  if (!response) {
    throw new Error(
      `[SystemDecompose] Task decomposition failed. Last error: ${lastError?.message}`
    );
  }

  console.log(`✅ System decompose: ${response.documentType}, ${response.tasks.length} tasks → [${response.targetFiles.join(', ')}]`);

  // ExecutionTier: LLM SSOT — `<executionTier>N</executionTier>` emitted
  // as one of the external meta tags (before `<tasks>`). Missing tag
  // degrades to Tier 0 Reflex (safe default — see
  // core/executionTier/parseExecutionTierTag.ts).
  const executionTier = coerceExecutionTier(
    parseExecutionTierTag(rawResponse),
    'SystemDecompose',
  );
  console.log(`🧭 [SystemDecompose] executionTier=${executionTier}`);

  // Build graph-level TechTier: prefer LLM-provided techTier, fallback to detected stack
  const graphTechTier = response.techTier
    ? buildTechTier({ language: response.techTier.language, framework: response.techTier.framework }, (response.techTier.stack as Stack) || detectedEnv)
    : buildTechTier(undefined, detectedEnv);
  console.log(`✅ TechTier: stack=${graphTechTier.stack || detectedEnv}, language=${graphTechTier.language}, framework=${graphTechTier.framework || 'none'}`);

  // Sync to RAC basis.techTier (TechTierConfig) so getTechTier(state) returns it
  const tierKey = graphTechTier.stack === 'fullstack' ? undefined : graphTechTier.stack;
  const basisTechTierConfig: TechTierConfig = {
    stack: graphTechTier.stack,
    ...(tierKey === 'frontend' || graphTechTier.stack === 'fullstack'
      ? { frontend: { ...graphTechTier, stack: 'frontend' as const } } : {}),
    ...(tierKey === 'backend' || graphTechTier.stack === 'fullstack'
      ? { backend: { ...graphTechTier, stack: 'backend' as const } } : {}),
    ...(!tierKey && graphTechTier.stack !== 'fullstack'
      ? { frontend: graphTechTier } : {}),
  };
  state.resolvedAction = {
    ...state.resolvedAction!,
    basis: { ...state.resolvedAction?.basis, techTier: basisTechTierConfig },
  };

  // Build task queue. Explicit techTier (raw, never merged with LLM emit)
  // is forwarded so per-task tiers preserve user-pinned framework/language.
  const taskQueue = buildTaskQueue(response, sourceFileNames, basisTechTierConfig, state.actionMetadata?.basis?.techTier);

  // Log decompose result
  await safeLogPrompt(
    state.context.featurePath,
    ctx.newJobId,
    'decompose-systemDesign-result',
    JSON.stringify(response).length,
    {
      templatePath: 'jobs/design/nodes/decompose/variants/system-design/base',
      injectedVariables: {
        documentType: response.documentType,
        services: response.services || [],
        packageTiers: response.packageTiers || {},
        targetFiles: response.targetFiles,
        taskCount: response.tasks.length,
        tasks: response.tasks.map(t => ({ id: t.id, name: t.name, targetFile: t.targetFile, priority: t.priority }))
      },
    }
  );

  if (taskQueue.size() === 0) {
    throw new Error('No tasks in queue after decompose');
  }

  // Snapshot estimating phase token usage
  const estimatingTokenUsage = state.tokenUsage
    ? { ...state.tokenUsage }
    : undefined;
  if (estimatingTokenUsage && state.deps?.kanbanUpdate?.setEstimatingTokenUsage) {
    state.deps.kanbanUpdate.setEstimatingTokenUsage(estimatingTokenUsage);
  }

  // Reset task-level token usage (will be used by first task in plan node)
  const { resetTaskTokenUsage } = await import('../../../../../common/graph/llmHelpers');
  resetTaskTokenUsage(state);

  // Finalize estimating phase
  const phaseBreakdown = { ...(state._phaseTimings || {}), decompose: Date.now() - ctx.phaseStart };
  const finalJobTiming = JobTimingManager.finalizeEstimatingPhase(ctx.newJobTiming, ctx.estimatingStartTime, phaseBreakdown);
  if (state.deps?.kanbanUpdate?.setJobTiming) {
    state.deps.kanbanUpdate.setJobTiming(finalJobTiming);
  }

  state.jobId = ctx.newJobId;
  state.jobTiming = finalJobTiming;
  state._estimatingTokenUsage = estimatingTokenUsage;
  state.executionTier = executionTier;
  await saveDecomposeCheckpoint(state, {
    taskQueue: taskQueue.getAll(),
    completedTasks: [],
    completedTasksDetails: [],
  });

  // Update Kanban (tasks in queue, no in-progress yet)
  updateKanban(state, null, taskQueue.getAll());

  await recordUserTurnMeta({
    session: state.deps?.session,
    turnId: state.turnId,
    jobId: ctx.newJobId,
    jobType: 'design',
    executionTier,
    nodeLabel: 'SystemDecompose',
  });

  return {
    ...state,
    taskQueue,
    currentTask: undefined,
    completedTasks: [],
    _httpJobId: state._httpJobId,
    jobId: ctx.newJobId,
    jobTiming: finalJobTiming,
    _estimatingTokenUsage: estimatingTokenUsage,
    executionTier,
    boundary: BOUNDARY.HEAVYWEIGHT,
  } as any;
}
