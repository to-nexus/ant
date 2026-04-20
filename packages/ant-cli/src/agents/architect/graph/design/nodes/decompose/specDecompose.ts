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
import { LLM_TEMPERATURE } from "../../../../../common/graph/llmConfig";
import {
  saveCheckpoint,
  updateKanban,
  safeLogPrompt,
  resolveLLMClient,
  showChatPlaceholder,
  trackTokenUsage,
  type CheckpointData,
} from "./helpers";
import { ARTIFACT_PREFIX, BOUNDARY, buildTechTier, type TechTierConfig } from "@ant/shared";

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
    `You are a software architect. Analyze the following directive and decide how to structure a spec document.`,
    ``,
    `Rules:`,
    `- If the directive covers a SINGLE topic, return exactly 1 section.`,
    `- If the directive covers MULTIPLE distinct topics or subsystems, split into one section per topic (max 5).`,
    `  Each section becomes a chapter appended to the same document.`,
    `- Each section MUST be a self-contained writing unit that explores AND writes its chapter.`,
    `  NEVER create "analysis-only" or "writing-only" sections — every section must produce document content.`,
    `- Sections are ordered: earlier sections are written first and provide context for later ones.`,
    ``,
    `Directive: "${directive}"`,
    ``,
    `Respond with ONLY a JSON object (no markdown):`,
    `{`,
    `  "slug": "short-url-safe-slug",`,
    `  "title": "Human Readable Title",`,
    `  "sections": [`,
    `    { "id": "spec-{slug}-1", "name": "Chapter Name", "scope": "What this chapter covers" }`,
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
  const jobMode = state.resolvedAction?.mode || 'generate';

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
      include: [ARTIFACT_PREFIX.SOURCES, ARTIFACT_PREFIX.API_CONTRACT],
      artifactPolicy: {
        refs: [ARTIFACT_PREFIX.SOURCES, ARTIFACT_PREFIX.API_CONTRACT],
      },
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

  await saveCheckpoint(state, {
    taskQueue: taskQueue.getAll(),
    completedTasks: [],
    completedTasksDetails: [],
    jobId: ctx.newJobId,
    jobTiming: ctx.newJobTiming,
    tokenUsage: state.tokenUsage,
    estimatingTokenUsage: state.tokenUsage,
    overrideDirective: state.overrideDirective,
    chatSource: state.chatSource,
    userLanguage: state.context.userLanguage as CheckpointData['userLanguage'],
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
    _phaseTimings: {
      ...(state._phaseTimings || {}),
      decompose: Date.now() - ctx.phaseStart,
    },
    boundary: BOUNDARY.LIGHTWEIGHT,
  } as any;
}
