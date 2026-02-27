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
import { TaskQueue } from "../../../code/state";
import { LLM_TEMPERATURE } from "../../../../../common/graph/llmConfig";
import {
  saveCheckpoint,
  updateKanban,
  safeLogPrompt,
  resolveLLMClient,
  showChatPlaceholder,
  trackTokenUsage,
} from "./helpers";

interface DecomposeContext {
  phaseStart: number;
  newJobId: string;
  newJobTiming: any;
}

// ─────────────────────────────────────────────────────────────
// LLM response shape
// ─────────────────────────────────────────────────────────────

interface SpecSection {
  id: string;       // e.g. "spec-social-login-1"
  name: string;     // e.g. "Overview & Requirements"
  scope: string;    // Description of what this section covers
}

interface SpecDecomposeResponse {
  slug: string;
  title: string;
  sections: SpecSection[];
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
    sections: [
      {
        id: `spec-feature-${Date.now()}-1`,
        name: 'Full Spec',
        scope: directive,
      },
    ],
  });

  if (!llm) return fallback();

  const prompt = [
    `You are a software architect. Analyze the following directive and decompose it into`,
    `sequential spec document sections.`,
    ``,
    `Rules:`,
    `- Return 1 section for simple, single-boundary tasks.`,
    `- Return 2–5 sections for complex, multi-boundary tasks.`,
    `- Sections must be ordered: earlier sections feed context into later ones.`,
    `- Each section must be independently writable given the previous sections.`,
    ``,
    `Directive: "${directive}"`,
    ``,
    `Respond with ONLY a JSON object (no markdown):`,
    `{`,
    `  "slug": "short-url-safe-slug",`,
    `  "title": "Human Readable Title",`,
    `  "sections": [`,
    `    { "id": "spec-{slug}-1", "name": "Section Name", "scope": "What this section covers" },`,
    `    { "id": "spec-{slug}-2", "name": "Section Name", "scope": "What this section covers" }`,
    `  ]`,
    `}`,
  ].join('\n');

  try {
    const result = await (llm as any).invokeWithUsage?.(
      [{ role: 'user', content: prompt }],
      { temperature: LLM_TEMPERATURE.DETECT, maxTokens: 512 }
    );
    const response: string = result?.content || await llm.invoke([{ role: 'user', content: prompt }]);

    await trackTokenUsage(state, result?.usage);

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in LLM response');

    const parsed: SpecDecomposeResponse = JSON.parse(jsonMatch[0]);

    // Validate
    const slug = (parsed.slug || '').replace(/[^a-z0-9-]/g, '').slice(0, 40) || `feature-${Date.now()}`;
    const title = parsed.title || directive.slice(0, 60);
    const sections: SpecSection[] = Array.isArray(parsed.sections) && parsed.sections.length > 0
      ? parsed.sections.map((s, i) => ({
          id: s.id || `spec-${slug}-${i + 1}`,
          name: s.name || `Section ${i + 1}`,
          scope: s.scope || '',
        }))
      : [{ id: `spec-${slug}-1`, name: 'Full Spec', scope: directive }];

    return { slug, title, sections };
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
  const jobMode = state.detectionReport?.jobMode || 'generate';

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📋 SPEC DECOMPOSE');
  console.log(`   Mode: ${jobMode}`);
  console.log(`   Directive: ${directive.slice(0, 100)}...`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  await showChatPlaceholder();

  const { slug, title, sections } = await decomposeSpecSections(state);
  const targetFile = `spec-${slug}.md`;

  console.log(`📋 [specDecompose] Target: ${targetFile} ("${title}") — ${sections.length} section(s)`);
  sections.forEach((s, i) => console.log(`   ${i + 1}. ${s.name}: ${s.scope.slice(0, 80)}`));

  // Build one DesignTask per section
  const taskQueue = new TaskQueue<DesignTask>();

  sections.forEach((section, index) => {
    const task: DesignTask = {
      id: section.id,
      name: `Spec: ${title} — ${section.name}`,
      type: 'doc',
      priority: 200 + index * 10,
      targetFile,
      description: directive,
      sectionIndex: index,
      totalSections: sections.length,
      sectionScope: section.scope,
      parallelGroup: `spec-${slug}`,
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
    { targetFile, slug, title, sectionCount: sections.length, jobMode }
  );

  await saveCheckpoint(state, {
    taskQueue: taskQueue.getAll(),
    completedTasks: [],
    completedTasksDetails: [],
    jobId: ctx.newJobId,
    jobTiming: ctx.newJobTiming,
    tokenUsage: (state as any).tokenUsage,
    estimatingTokenUsage: (state as any).tokenUsage,
    overrideDirective: state.overrideDirective,
    chatSource: state.chatSource,
  });

  return {
    ...state,
    taskQueue,
    completedTasks: [],
    completedTasksDetails: [],
    _httpJobId: state._httpJobId,
    jobId: ctx.newJobId,
    jobTiming: ctx.newJobTiming,
    _estimatingTokenUsage: (state as any).tokenUsage,
    _phaseTimings: {
      ...(state._phaseTimings || {}),
      decompose: Date.now() - ctx.phaseStart,
    },
  } as any;
}
