/**
 * Spec Decompose
 *
 * LLM-driven chapter decomposition for spec document generation.
 * The LLM analyzes the directive and decides how many sections are needed,
 * producing one DesignTask per section. Each section writes to the same
 * spec-{slug}.md file (appended sequentially).
 *
 * For simple directives, the LLM may return a single section — identical
 * behaviour to the previous implementation, with no regression.
 */

import { DesignGraphState } from "../../state";
import { DesignTask } from "../../../../types/task";
import { TaskQueue } from "../../../../types/task";
import { LLM_TEMPERATURE, LLM_MAX_TOKENS } from "../../../../../common/graph/llmConfig";
import { updateKanban, createDesignTaskStreamingHook } from "./kanbanUpdate";
import { resolveLLMClient, showChatPlaceholder } from "./llmClient";
import { applyEstimatingUsage } from "../../../../../common/graph/llmHelpers";
import { safeLogPrompt } from "../../utils/promptLog";
import { saveDecomposeCheckpoint } from "../../session/checkpoint";
import { ARTIFACT_PREFIX, BOUNDARY } from "@ant/shared";
import { resolveDesignBasisTechTier } from "./resolveDesignBasisTechTier";
import { parseExecutionTierTag, coerceExecutionTier, recordUserTurnMeta, ExecutionTierId } from "../../../../../../core/executionTier";
import { parseLLMJsonResponse } from "../../utils/jsonResponseParser";
import { appendPrdSyncTasks, resolvePrdSyncTargets } from "./prdSync";
import { ArtifactPoolView, isAssetPoolPath } from "../../../../../../core/prompt/builder/ArtifactPipeline";
import { sanitizeDocSlug, collisionFreeDocFilename } from "../../../../../common/naming/docSlug";
import { extractMarkdownHeadings } from "../checkTaskStatus/specDocIntegrity";
import { loadExistingDesignDoc } from "../checkTaskStatus/loadExistingDesignDoc";

const SPEC_TARGET_DIR = 'architecture/spec';

interface DecomposeContext {
  phaseStart: number;
  newJobId: string;
  newJobTiming: any;
}

// ─────────────────────────────────────────────────────────────
// LLM response shape
//
// Each task is one chapter of the same spec-{slug}.md document; the
// `tasks` name aligns with the project-wide decompose contract (vs.
// the legacy `sections` alias) so the design jsonResponseParser v2
// surfaces them via the same `<tasks><task>{json}</task></tasks>`
// path the ui / system / game-art variants use.
// ─────────────────────────────────────────────────────────────

interface SpecTask {
  id: string;          // e.g. "spec-social-login-1"
  name: string;        // e.g. "Overview & Requirements"
  description: string; // Per-task scope of work (canonical BaseTask.description)
}

interface SpecDecomposeResponse {
  slug: string;
  title: string;
  tasks: SpecTask[];
  executionTier: ExecutionTierId;
  /** Cross-intent PRD sync decision (generate mode only; see `prdSync.ts`). */
  prdSync?: { targets?: string[]; reason?: string };
}

function stripDesignTargetPrefix(file: string): string {
  return file.split('/').pop() ?? file;
}

function isValidSpecFileName(file: string): boolean {
  // Current: prefix-less (file already lives under architecture/spec/).
  // Legacy:  spec-* prefix (kept for BC with workspaces created before
  //          the prefix was dropped — see plan spec-giggly-glade.md).
  return /^(spec-)?[a-z0-9][a-z0-9-]*\.md$/.test(file);
}

export async function resolveSpecTargetFileForMode(
  state: DesignGraphState,
  jobMode: string,
  slug: string,
): Promise<string> {
  if (jobMode !== 'refactor') {
    const baseName = `${slug}.md`;
    const fs = state.deps?.fileSystem;
    if (!fs || !state.context?.featurePath) {
      // Deps unavailable (e.g. unit test harness) — skip the disk check and
      // emit the plain filename. Disk collisions are the only reason to
      // append a mnemonic, so the no-deps path is the same as "no collision".
      return baseName;
    }
    return collisionFreeDocFilename(slug, (filename) =>
      fs.fileExists(`${state.context!.featurePath}/${SPEC_TARGET_DIR}/${filename}`),
    );
  }

  const targets = state.resolvedAction?.target ?? [];
  if (targets.length !== 1) {
    throw new Error(
      `[specDecompose] rev-spec requires exactly one target file, got ${targets.length}`,
    );
  }

  const fileName = stripDesignTargetPrefix(targets[0]);
  if (!isValidSpecFileName(fileName)) {
    throw new Error(
      `[specDecompose] rev-spec target must match a spec filename (e.g. wallet-login.md or legacy spec-wallet-login.md): ${fileName}`,
    );
  }

  return fileName;
}

// ─────────────────────────────────────────────────────────────
// LLM call: decompose directive into slug + sections
// ─────────────────────────────────────────────────────────────

/**
 * Attached-input visibility (paths only — bodies are provided to the writing
 * phase). Spec decompose is deliberately directive-only for its single
 * decision ("how many output documents"), but the RAC attachment PATHS must
 * still be visible so the decompose never scopes a task as if an explicitly
 * attached file did not exist (fierce-gaining-gully: an attached
 * `assets/game/models/*.glb` was invisible here and downstream).
 */
export function buildAttachedInputLines(
  artifacts: ReadonlyArray<{ path: string; role: string; kind?: 'binary' | 'text' }>,
): string[] {
  if (!artifacts.length) return [];
  const lines = artifacts.map(a => {
    // Key off the byte class, not the directory: an attached binary is
    // "reference by path" wherever the user put it. `kind` absent (checkpoint
    // restore predating the sniff) falls back to the pool-path test.
    const isAsset = a.kind === 'binary' || (a.kind === undefined && isAssetPoolPath(a.path));
    const assetNote = isAsset ? ' (asset — reference by path)' : '';
    return `- ${a.path} [${a.role}]${assetNote}`;
  });
  return ['', 'Attached input files (paths only — bodies are provided to the writing phase):', ...lines];
}

async function decomposeSpecSections(
  state: DesignGraphState
): Promise<SpecDecomposeResponse> {
  const directive = state.overrideDirective || state.directive || '';
  const llm = await resolveLLMClient(state);

  const fallback = (): SpecDecomposeResponse => ({
    slug: `feature-${Date.now()}`,
    title: directive.slice(0, 60),
    tasks: [
      {
        id: `spec-feature-${Date.now()}-1`,
        name: 'Full Spec',
        description: buildFullSpecScope(),
      },
    ],
    executionTier: ExecutionTierId.Reflex,
  });

  if (!llm) return fallback();

  // Streaming Kanban hook — surfaces each `<task>` body (chapter) as it
  // streams so the todo column populates chapter-by-chapter rather than
  // all-at-once after the full response. The final updateKanban below
  // overwrites the partial buffer with the richer per-chapter
  // DesignTask shape.
  const streamingHook = createDesignTaskStreamingHook(state);

  const attachedBlock = buildAttachedInputLines(state.artifacts ?? []);

  const prompt = [
    `You are a software architect. Analyze the following directive and decide how to structure a spec document.`,
    ``,
    `Principle — same output document = 1 task:`,
    `- The output of this job is ONE spec markdown file. Do NOT split that single file into chapter tasks. A single document MUST be authored as one cohesive task; chaptering belongs inside the document body, not at the task level.`,
    `- Emit MORE than one task ONLY when the directive genuinely needs SEPARATE output documents (different file slugs / titles). That is rare for spec jobs.`,
    ``,
    `Principle — do NOT pre-decide the solution at decompose:`,
    `- Task \`name\` and \`description\` describe WHAT to think about, NOT the chosen structure or section list. Do NOT bake an outline, table of contents, or specific decisions into them — the execute phase owns that thinking.`,
    `- \`description\` names the unit of work and its scope of thinking in your own words. Do NOT restate the directive verbatim — the directive is delivered to every phase on its own channel.`,
    `- Authoring tasks are self-contained writing units; never emit "analysis-only" or "writing-only" tasks.`,
    ``,
    `ExecutionTier (BEFORE the meta tags, emit exactly one \`<executionTier>N</executionTier>\` tag where N is 0..4):`,
    `  0 Reflex        — read-only, no spec document produced.`,
    `  1 OneShot       — single concrete edit to one spec chapter.`,
    `  2 Exploratory   — requires observing sources before writing; still a single cohesive edit.`,
    `  3 Task          — multiple separate output documents driven by the directive alone, without systematic grounding on refs.`,
    `  4 RefsGrounded  — multiple separate output documents systematically grounded in supplied reference documents.`,
    ``,
    `Directive: "${directive}"`,
    ...attachedBlock,
    ``,
    `Output format — emit the meta tags first (one tag per line), then a \`<tasks>\` block with one \`<task>{json}</task>\` element per output document. Each \`<task>\` body is a single JSON object carrying exactly \`id\`, \`name\`, \`description\`. NO markdown fences anywhere. NO \`<decompose>\` wrapper.`,
    ``,
    `PRD Sync (optional meta tag): if the directive ALSO asks to update / sync / keep-consistent a related planning document, emit a \`<prdSync>{"targets":["plan/<doc>.md"],"reason":"<one sentence>"}</prdSync>\` tag naming the plan doc(s) present in your input context. The system then appends a task that reconciles that doc AFTER this spec is written. Omit the tag entirely when the directive is silent on the PRD or no plan doc is in context. Never invent a plan path.`,
    ``,
    `Slug rules:`,
    `- Shape: 1–3 lowercase hyphenated words. Pick the shortest form that still identifies the spec's scope.`,
    `- Prefix: the file lives under \`architecture/spec/\` — do NOT add a \`spec-\` prefix.`,
    `- Collision: the system appends a 2-word mnemonic automatically when the slug already exists on disk — do NOT add one yourself.`,
    ``,
    `Example:`,
    `<executionTier>2</executionTier>`,
    `<slug>your-spec-subject</slug>`,
    `<title>Human Readable Title</title>`,
    `<tasks>`,
    `  <task>{"id":"spec-{slug}-1","name":"Full Spec","description":"Scope of thinking for the entire document — surface and outcome to investigate. Do NOT pre-decide the chapter structure."}</task>`,
    `</tasks>`,
  ].join('\n');

  try {
    // Stream through `callLLMWithToolLoop` (no tools, single round) so
    // the new contract's `<task>` wrappers surface `task_added` actions
    // and the streaming Kanban hook fills task-by-task during spec
    // decompose too. Previously `invokeWithUsage` was single-shot and
    // gave `XMLStreamParser` nothing to scan mid-stream.
    const { callLLMWithToolLoop } = await import('../../../../../common/llm/callLLMWithToolLoop');
    const { response, usage } = await callLLMWithToolLoop(
      llm,
      [{ role: 'user', content: prompt }],
      [],
      () => `Error: tools are not available in spec decompose`,
      {
        temperature: LLM_TEMPERATURE.DETECT,
        maxTokens: LLM_MAX_TOKENS.DEFAULT,
        state: state as any,
        onTaskParsed: streamingHook.onTaskParsed,
      },
    );
    applyEstimatingUsage(state, 'decompose', usage, { subNode: 'spec', promptChars: prompt.length, modelId: llm.modelName });

    const parsed = parseLLMJsonResponse(response);

    // Cap + `[a-z0-9-]` sanitize leaves room for the optional `-{adj}-{noun}`
    // mnemonic appended by resolveSpecTargetFileForMode() on disk collision.
    const slug = sanitizeDocSlug(parsed.slug, `feature-${Date.now()}`);
    const title = (typeof parsed.title === 'string' && parsed.title.length > 0)
      ? parsed.title
      : directive.slice(0, 60);
    const tasks: SpecTask[] = Array.isArray(parsed.tasks) && parsed.tasks.length > 0
      ? parsed.tasks.map((t: any, i: number) => {
          // Description floor: spec has no repair loop (catch → fallback()), so a
          // throw would discard a good decomposition over one bad field —
          // synthesize the deterministic full-document scope instead.
          let description = typeof t.description === 'string' ? t.description.trim() : '';
          if (!description) {
            console.warn(
              `⚠️  [specDecompose] task ${i + 1} omitted "description" — substituting the full-document scope`,
            );
            description = buildFullSpecScope();
          }
          return {
            id: typeof t.id === 'string' && t.id.length > 0 ? t.id : `spec-${slug}-${i + 1}`,
            name: typeof t.name === 'string' && t.name.length > 0 ? t.name : `Section ${i + 1}`,
            description,
          };
        })
      : [{ id: `spec-${slug}-1`, name: 'Full Spec', description: buildFullSpecScope() }];

    const executionTier = coerceExecutionTier(
      parseExecutionTierTag(response),
      'SpecDecompose',
    );

    return { slug, title, tasks, executionTier, prdSync: parsed.prdSync };
  } catch (error) {
    console.warn('⚠️  [specDecompose] Failed to decompose via LLM, using fallback:', error);
    return fallback();
  }
}

// ─────────────────────────────────────────────────────────────
// Refactor mode — deterministic revision task (no LLM)
//
// `resolveSpecTargetFileForMode` already pins refactor to exactly ONE
// target file, so the decompose LLM's only real decision ("how many
// output documents?") is pre-answered = 1. Skipping the LLM closes the
// mis-framing gap at its source: the revision task's scope is authored
// here, deterministically, as "existing document + directive as delta"
// — the LLM cannot re-frame the job as a fresh narrow document.
// ─────────────────────────────────────────────────────────────

interface SpecRevisionDecomposition {
  title: string;
  tasks: SpecTask[];
  executionTier: ExecutionTierId;
  revisionBaselineHeadings: string[];
}

function buildRevisionScope(targetFile: string): string {
  return (
    `REVISION of the existing document architecture/spec/${targetFile}. ` +
    `The unit of work is the existing document with the user directive applied as a delta: ` +
    `change only what the directive affects; every section the directive does not affect is preserved verbatim; ` +
    `the output is the full revised document.`
  );
}

// Deterministic degenerate-case scope (LLM omitted `description`, LLM returned
// no tasks, or the LLM-free fallback path). Deliberately directive-free: the
// directive is already on its own prompt channel (`# User Directive`), so
// restating it here would rebuild the double-injection defect this file
// existed to avoid.
function buildFullSpecScope(): string {
  return (
    'Author the complete spec document end to end. The unit of work is the entire ' +
    'directive stated in the User Directive section — no chapter split.'
  );
}

export async function buildSpecRevisionDecomposition(
  state: DesignGraphState,
  targetFile: string,
): Promise<SpecRevisionDecomposition> {
  const existing = await loadExistingDesignDoc(state, targetFile, SPEC_TARGET_DIR);
  if (!existing) {
    console.warn(
      `⚠️  [specDecompose] rev-spec target ${targetFile} not readable — proceeding with empty revision baseline (execute will author fresh; preservation gate no-ops)`,
    );
  }

  const headings = existing ? extractMarkdownHeadings(existing) : [];
  const h1 = headings.find((h) => h.level === 1)?.text;
  const title = (h1 ?? targetFile.replace(/\.md$/, '')).replace(/^spec:\s*/i, '').trim();
  const baseId = targetFile.replace(/\.md$/, '');

  return {
    title,
    tasks: [
      {
        id: `spec-${baseId}-rev-1`,
        name: 'Revision',
        description: buildRevisionScope(targetFile),
      },
    ],
    executionTier: ExecutionTierId.Exploratory,
    revisionBaselineHeadings: headings.filter((h) => h.level === 2).map((h) => h.text),
  };
}

// ─────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────

export async function decomposeSpec(
  state: DesignGraphState,
  ctx: DecomposeContext
): Promise<DesignGraphState> {
  const directive = state.overrideDirective || state.directive || '';
  const jobMode = state.resolvedAction?.mode || 'generate';
  const isRefactor = jobMode === 'refactor';

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📋 SPEC DECOMPOSE');
  console.log(`   Mode: ${jobMode}`);
  console.log(`   Directive: ${directive.slice(0, 100)}...`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  await showChatPlaceholder();

  // Refactor resolves the target first (it IS the existing file); generate
  // needs the LLM's slug before it can name the file.
  let targetFile: string;
  let title: string;
  let tasks: SpecTask[];
  let executionTier: ExecutionTierId;
  let revisionBaselineHeadings: string[] | undefined;
  // Cross-intent PRD sync (generate mode only — refactor takes the LLM-free
  // deterministic path and cannot emit `<prdSync>`).
  let prdSync: { targets?: string[]; reason?: string } | undefined;

  if (isRefactor) {
    targetFile = await resolveSpecTargetFileForMode(state, jobMode, '');
    const revision = await buildSpecRevisionDecomposition(state, targetFile);
    ({ title, tasks, executionTier, revisionBaselineHeadings } = revision);
  } else {
    const decomposed = await decomposeSpecSections(state);
    ({ title, tasks, executionTier, prdSync } = decomposed);
    targetFile = await resolveSpecTargetFileForMode(state, jobMode, decomposed.slug);
  }
  console.log(`🧭 [SpecDecompose] executionTier=${executionTier}`);
  const parallelGroup = targetFile.replace(/\.md$/, '');

  console.log(`📋 [specDecompose] Target: ${targetFile} ("${title}") — ${tasks.length} chapter(s)`);
  tasks.forEach((t, i) => console.log(`   ${i + 1}. ${t.name}: ${t.description.slice(0, 80)}`));

  // Build one DesignTask per chapter
  const taskQueue = new TaskQueue<DesignTask>();

  tasks.forEach((chapter, index) => {
    const task: DesignTask = {
      id: chapter.id,
      name: `Spec: ${title} — ${chapter.name}`,
      type: 'doc',
      priority: 200 + index * 10,
      targetFile,
      targetDir: SPEC_TARGET_DIR,
      description: chapter.description,
      sectionIndex: index,
      totalSections: tasks.length,
      include: [ARTIFACT_PREFIX.SOURCES, ARTIFACT_PREFIX.API_CONTRACT],
      parallelGroup,
      completed: false,
      ...(revisionBaselineHeadings ? { revisionBaselineHeadings } : {}),
    };
    taskQueue.push(task);
  });

  // Cross-intent PRD sync — append a single-owner sync task per validated plan
  // target when the directive asked to keep the PRD in sync (runs LAST).
  const specPool = new ArtifactPoolView(state.artifacts || []);
  appendPrdSyncTasks(taskQueue, resolvePrdSyncTargets(prdSync, specPool));

  updateKanban(state, null, taskQueue.getAll());

  await safeLogPrompt(
    state.context.featurePath,
    ctx.newJobId,
    'decompose-spec',
    directive.length,
    { targetFile, title, sectionCount: tasks.length, jobMode }
  );

  // Anchor techTier to the EXISTING codebase via the single design-side owner
  // (resolveDesignBasisTechTier), NOT the intent-id suffix. Spec intents have no
  // -fe/-be variant, so the old `?? 'frontend'` default mislabeled every backend
  // project. Greenfield / undetectable → leave basis.techTier unset (no
  // fabrication); renderTechTierSection early-returns when no stack is present.
  const resolvedTechTier = await resolveDesignBasisTechTier(state);
  if (resolvedTechTier) {
    console.log(`✅ TechTier (codebase-anchored): stack=${resolvedTechTier.stack}, fe=${resolvedTechTier.frontend?.framework || resolvedTechTier.frontend?.language || 'none'}, be=${resolvedTechTier.backend?.framework || resolvedTechTier.backend?.language || 'none'}`);
    state.resolvedAction = {
      ...state.resolvedAction!,
      basis: { ...state.resolvedAction?.basis, techTier: resolvedTechTier },
    };
  } else {
    console.log('ℹ️ TechTier: no existing-codebase signal; leaving basis.techTier unset (greenfield-safe)');
  }

  state.jobId = ctx.newJobId;
  state.jobTiming = ctx.newJobTiming;
  state._estimatingTokenUsage = state.tokenUsage;
  state.executionTier = executionTier;
  await saveDecomposeCheckpoint(state, {
    taskQueue: taskQueue.getAll(),
    completedTasks: [],
    completedTasksDetails: [],
  });

  await recordUserTurnMeta({
    session: state.deps?.session,
    turnId: state.turnId,
    jobId: ctx.newJobId,
    jobType: 'design',
    executionTier,
    nodeLabel: 'SpecDecompose',
  });

  return {
    ...state,
    taskQueue,
    completedTasks: [],
    completedTasksDetails: [],
    _httpJobId: state._httpJobId,
    jobId: ctx.newJobId,
    jobTiming: ctx.newJobTiming,
    _estimatingTokenUsage: state.tokenUsage,
    executionTier,
    _phaseTimings: {
      ...(state._phaseTimings || {}),
      decompose: Date.now() - ctx.phaseStart,
    },
    boundary: BOUNDARY.LIGHTWEIGHT,
  } as any;
}
