/**
 * Spec Decompose
 * 
 * Creates a single task for spec document generation.
 * Unlike system-design (multi-file LLM decomposition) and ui-design (multi-chapter LLM decomposition),
 * spec always produces exactly ONE document: spec-{slug}.md.
 * 
 * The slug is derived from the directive using a lightweight LLM call.
 */

import { DesignGraphState } from "../../state";
import { DesignTask } from "../../../../types/task";
import { TaskQueue } from "../../../code/state";
import { LLM_TEMPERATURE, LLM_MAX_TOKENS } from "../../../../../common/graph/llmConfig";
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

/**
 * Generate a URL-safe slug from LLM analysis of the directive.
 * Falls back to a timestamp-based slug if LLM fails.
 */
async function resolveSlug(
  state: DesignGraphState
): Promise<{ slug: string; specTitle: string }> {
  const directive = state.overrideDirective || state.directive || '';
  const llm = await resolveLLMClient(state);
  if (!llm) {
    return { slug: `feature-${Date.now()}`, specTitle: directive.slice(0, 60) };
  }

  const prompt = [
    `Given the following user directive, extract:`,
    `1. A short URL-safe slug (lowercase, hyphens, no spaces, max 40 chars) that identifies the feature/task.`,
    `2. A human-readable title for the spec document.`,
    ``,
    `Directive: "${directive}"`,
    ``,
    `Respond with ONLY a JSON object:`,
    `{"slug": "social-login", "title": "Social Login Integration"}`,
  ].join('\n');

  try {
    let response = '';
    for await (const event of llm.stream(
      [{ role: 'user', content: prompt }],
      { temperature: LLM_TEMPERATURE.DETECT, maxTokens: 256, enableThinking: false }
    )) {
      if (event.text) response += event.text;
      
      const { extractTokenUsageFromStreamEvent } = await import('../../../../../common/graph/llmHelpers');
      const usage = extractTokenUsageFromStreamEvent(event);
      if (usage) await trackTokenUsage(state, usage);
    }

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const slug = (parsed.slug || '').replace(/[^a-z0-9-]/g, '').slice(0, 40) || `feature-${Date.now()}`;
      const title = parsed.title || directive.slice(0, 60);
      return { slug, specTitle: title };
    }
  } catch (error) {
    console.warn('⚠️  [specDecompose] Failed to resolve slug via LLM:', error);
  }

  return { slug: `feature-${Date.now()}`, specTitle: directive.slice(0, 60) };
}

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

  const { slug, specTitle } = await resolveSlug(state);
  const targetFile = `spec-${slug}.md`;

  console.log(`📋 [specDecompose] Target: ${targetFile} ("${specTitle}")`);

  const task: DesignTask = {
    id: `spec-${slug}`,
    name: `Spec: ${specTitle}`,
    type: 'doc',
    priority: 200,
    targetFile,
    description: directive,
    completed: false,
  };

  const taskQueue = new TaskQueue<DesignTask>();
  taskQueue.push(task);

  updateKanban(state, null, taskQueue.getAll());

  await safeLogPrompt(
    state.context.featurePath,
    ctx.newJobId,
    'decompose-spec',
    directive.length,
    { targetFile, slug, jobMode }
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
