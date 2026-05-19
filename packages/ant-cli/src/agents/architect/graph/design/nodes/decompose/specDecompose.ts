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
import { ARTIFACT_PREFIX, BOUNDARY, buildTechTier, type TechTierConfig } from "@ant/shared";
import { parseExecutionTierTag, coerceExecutionTier, recordUserTurnMeta, ExecutionTierId } from "../../../../../../core/executionTier";
import { parseLLMJsonResponse } from "../../utils/jsonResponseParser";
import { generateMnemonic } from "../../../../../../utils/humanId";

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
  id: string;       // e.g. "spec-social-login-1"
  name: string;     // e.g. "Overview & Requirements"
  scope: string;    // Description of what this section covers
}

interface SpecDecomposeResponse {
  slug: string;
  title: string;
  tasks: SpecTask[];
  executionTier: ExecutionTierId;
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
    const exists = await fs.fileExists(`${state.context.featurePath}/${SPEC_TARGET_DIR}/${baseName}`);
    if (!exists) return baseName;
    return `${slug}-${generateMnemonic()}.md`;
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
        scope: directive,
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

  const prompt = [
    `You are a software architect. Analyze the following directive and decide how to structure a spec document.`,
    ``,
    `Principle — same output document = 1 task:`,
    `- The output of this job is ONE spec markdown file. Do NOT split that single file into chapter tasks. A single document MUST be authored as one cohesive task; chaptering belongs inside the document body, not at the task level.`,
    `- Emit MORE than one task ONLY when the directive genuinely needs SEPARATE output documents (different file slugs / titles). That is rare for spec jobs.`,
    ``,
    `Principle — do NOT pre-decide the solution at decompose:`,
    `- Task \`name\` and \`scope\` describe WHAT to think about, NOT the chosen structure or section list. Do NOT bake an outline, table of contents, or specific decisions into them — the docGen phase owns that thinking.`,
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
    ``,
    `Output format — emit the meta tags first (one tag per line), then a \`<tasks>\` block with one \`<task>{json}</task>\` element per output document. Each \`<task>\` body is a single JSON object. NO markdown fences anywhere. NO \`<decompose>\` wrapper.`,
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
    `  <task>{"id":"spec-{slug}-1","name":"Full Spec","scope":"Scope of thinking for the entire document — surface and outcome to investigate. Do NOT pre-decide the chapter structure."}</task>`,
    `</tasks>`,
  ].join('\n');

  try {
    // Stream through `decomposeWithToolLoop` (no tools, single round) so
    // the new contract's `<task>` wrappers surface `task_added` actions
    // and the streaming Kanban hook fills task-by-task during spec
    // decompose too. Previously `invokeWithUsage` was single-shot and
    // gave `XMLStreamParser` nothing to scan mid-stream.
    const { decomposeWithToolLoop } = await import('../docGen/sourceSelector');
    const { response, usage } = await decomposeWithToolLoop(
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
    applyEstimatingUsage(state, 'decompose', usage, { subNode: 'spec', promptChars: prompt.length });

    const parsed = parseLLMJsonResponse(response);

    const rawSlug = typeof parsed.slug === 'string' ? parsed.slug : '';
    // 30-char cap leaves room for the optional `-{adj}-{noun}` mnemonic
    // appended by resolveSpecTargetFileForMode() on disk collision.
    const slug = rawSlug.replace(/[^a-z0-9-]/g, '').slice(0, 30) || `feature-${Date.now()}`;
    const title = (typeof parsed.title === 'string' && parsed.title.length > 0)
      ? parsed.title
      : directive.slice(0, 60);
    const tasks: SpecTask[] = Array.isArray(parsed.tasks) && parsed.tasks.length > 0
      ? parsed.tasks.map((t: any, i: number) => ({
          id: typeof t.id === 'string' && t.id.length > 0 ? t.id : `spec-${slug}-${i + 1}`,
          name: typeof t.name === 'string' && t.name.length > 0 ? t.name : `Section ${i + 1}`,
          scope: typeof t.scope === 'string' ? t.scope : '',
        }))
      : [{ id: `spec-${slug}-1`, name: 'Full Spec', scope: directive }];

    const executionTier = coerceExecutionTier(
      parseExecutionTierTag(response),
      'SpecDecompose',
    );

    return { slug, title, tasks, executionTier };
  } catch (error) {
    console.warn('⚠️  [specDecompose] Failed to decompose via LLM, using fallback:', error);
    return fallback();
  }
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

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📋 SPEC DECOMPOSE');
  console.log(`   Mode: ${jobMode}`);
  console.log(`   Directive: ${directive.slice(0, 100)}...`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  await showChatPlaceholder();

  const { slug, title, tasks, executionTier } = await decomposeSpecSections(state);
  console.log(`🧭 [SpecDecompose] executionTier=${executionTier}`);
  const targetFile = await resolveSpecTargetFileForMode(state, jobMode, slug);
  const parallelGroup = targetFile.replace(/\.md$/, '');

  console.log(`📋 [specDecompose] Target: ${targetFile} ("${title}") — ${tasks.length} chapter(s)`);
  tasks.forEach((t, i) => console.log(`   ${i + 1}. ${t.name}: ${t.scope.slice(0, 80)}`));

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
      description: directive,
      sectionIndex: index,
      totalSections: tasks.length,
      sectionScope: chapter.scope,
      include: [ARTIFACT_PREFIX.SOURCES, ARTIFACT_PREFIX.API_CONTRACT],
      artifactPolicy: {
        refs: [ARTIFACT_PREFIX.SOURCES, ARTIFACT_PREFIX.API_CONTRACT],
      },
      parallelGroup,
      completed: false,
    };
    taskQueue.push(task);
  });

  updateKanban(state, null, taskQueue.getAll());

  await safeLogPrompt(
    state.context.featurePath,
    ctx.newJobId,
    'decompose-spec',
    directive.length,
    { targetFile, slug, title, sectionCount: tasks.length, jobMode }
  );

  // Spec uses project-level profile; stack inferred from intent
  const specStack = state.resolvedAction?.intent?.includes('-fe') ? 'frontend' as const
    : state.resolvedAction?.intent?.includes('-be') ? 'backend' as const
    : undefined;
  const specTechTier = buildTechTier(state.profile, specStack);
  console.log(`✅ TechTier: stack=${specStack || 'unset'}, language=${specTechTier.language}, framework=${specTechTier.framework || 'none'}`);

  // Sync to RAC basis.techTier so getTechTier(state) returns it
  const tierKey = specStack ?? 'frontend';
  const basisTechTierConfig: TechTierConfig = {
    stack: specStack,
    [tierKey]: { ...specTechTier, stack: tierKey as 'frontend' | 'backend' },
  };
  state.resolvedAction = {
    ...state.resolvedAction!,
    basis: { ...state.resolvedAction?.basis, techTier: basisTechTierConfig },
  };

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
