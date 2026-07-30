/**
 * Job-level final summary (plan curious-spinning-twilight)
 *
 * Emitted once at the job-end seam of the learn nodes (code / design), AFTER
 * the durable completion checkpoint and BEFORE distillAssistantTurn: a single
 * user-facing prose message that answers the directive's questions, states
 * what was done, and lists real remaining work — the wrap-up the per-task
 * cards never provide.
 *
 * Authoring is hybrid: a streamed LLM call (user watches it type) with a
 * deterministic template fallback on timeout / error / empty output. Failure
 * policy mirrors distillAssistantTurn: log + swallow — a summary miss never
 * aborts the owning learn node.
 */

import type { SessionPort } from '../ports/session';
import type { LLMClient } from '../ports/llm';
import type { TaskTokenUsage } from '../types/task';
import type { PromptPort } from '../ports/prompt';
import { LLM_TEMPERATURE } from '../ports/llmSampling';
import { assistantProseOf } from './chatTailBuilder';

/** Whole-call budget — the user is actively waiting at job end. */
export const JOB_SUMMARY_TIMEOUT_MS = 30_000;
export const JOB_SUMMARY_MAX_OUTPUT_TOKENS = 900;
/** Per-task harvested prose cap (chatTailBuilder assistant-cap precedent). */
const TASK_PROSE_CAP = 1600;
/** Chat-log read budget — awaited by the learn seam outside the emit timeout. */
const TASK_PROSE_HARVEST_TIMEOUT_MS = 5_000;
/** Max key paths cited in the prompt's fileChanges block. */
const TOP_PATHS_CAP = 12;

export interface JobSummaryTask {
  name: string;
  type?: string;
  description?: string;
  files?: string[];
}

export interface JobSummaryChatAPI {
  startMessage(): Promise<void>;
  sendLLMEvent(event: { type: 'text'; text: string }): Promise<void>;
  finalizeMessage(): Promise<void>;
}

export interface EmitJobFinalSummaryInput {
  session: SessionPort | undefined;
  chatAPI: JobSummaryChatAPI;
  llm?: LLMClient;
  promptPort?: PromptPort;
  jobType: 'code' | 'design';
  jobId?: string;
  turnId?: string;
  directive?: string;
  /** Additional directives (revisions), newest first. */
  directives?: string[];
  completedTasks: JobSummaryTask[];
  touched?: { created: string[]; edited: string[]; deleted: string[] };
  /** Unresolved-error one-liners (feeds "remaining work"). */
  unresolved?: string[];
  /** Per-task user-facing prose (see harvestTaskProse). */
  taskProse?: string[];
  /** Streaming usage sink — caller wires accumulate/broadcast. */
  onUsage?: (usage: TaskTokenUsage) => void;
}

/**
 * Emit the job's final summary to chat. Never throws.
 * Returns the emitted markdown (tests / distill outcomeHint), or undefined
 * when skipped.
 */
export async function emitJobFinalSummary(
  input: EmitJobFinalSummaryInput,
): Promise<string | undefined> {
  if (input.completedTasks.length === 0) {
    console.log('📝 [JobSummary] skipped: no completed tasks');
    return undefined;
  }

  try {
    const text =
      (await tryLlmSummary(input)) ?? (await emitFallbackSummary(input));
    return text;
  } catch (err) {
    console.warn(`⚠️  [JobSummary] emission failed (jobId=${input.jobId ?? 'unknown'}):`, err);
    return undefined;
  }
}

/** Streamed LLM summary; undefined signals "use the fallback". */
async function tryLlmSummary(input: EmitJobFinalSummaryInput): Promise<string | undefined> {
  const { llm, promptPort, chatAPI } = input;
  if (!llm?.stream || !promptPort) return undefined;

  let systemPrompt: string;
  try {
    systemPrompt = await promptPort.render('infra/job-summary/system', buildTemplateVars(input));
  } catch (err) {
    console.warn('⚠️  [JobSummary] template render failed, using fallback:', err);
    return undefined;
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: 'Write the final wrap-up message now.' },
  ];

  let responseText = '';
  let started = false;
  // The timeout rejects the wrapper but cannot abort the stream itself (the
  // LLM port takes no AbortSignal), so the orphaned iterator keeps producing
  // events after we have already fallen back. Without this flag those events
  // reopen a turn buffer nobody finalizes — a dangling streaming overlay, or a
  // second message interleaved with the fallback's. Gate the loop AND every
  // chat emission on it so the orphan is observably inert; it drains silently.
  let cancelled = false;
  try {
    await withTimeout(
      (async () => {
        for await (const event of llm.stream(messages, {
          maxTokens: JOB_SUMMARY_MAX_OUTPUT_TOKENS,
          enableThinking: false,
          temperature: LLM_TEMPERATURE.SUMMARIZE,
        })) {
          if (cancelled) break;
          if (event.type === 'text' && event.text) {
            if (!started) {
              started = true;
              await chatAPI.startMessage();
            }
            responseText += event.text;
            if (cancelled) break;
            await chatAPI.sendLLMEvent({ type: 'text', text: event.text });
          }
          if (event.type === 'done' && event.usage) {
            input.onUsage?.(event.usage);
          }
          if (event.type === 'error') {
            throw new Error(event.error?.message ?? 'stream error');
          }
        }
      })(),
      JOB_SUMMARY_TIMEOUT_MS,
      () => { cancelled = true; },
    );
  } catch (err) {
    console.warn('⚠️  [JobSummary] LLM stream failed, using fallback:', err);
    // A partially-streamed message must still be closed; the fallback then
    // emits as its own complete message.
    if (started) {
      try { await input.chatAPI.finalizeMessage(); } catch { /* transport already broken */ }
      return responseText.trim() || undefined;
    }
    return undefined;
  }

  if (!started || !responseText.trim()) return undefined;
  await chatAPI.finalizeMessage();
  console.log(`📝 [JobSummary] emitted (${responseText.length} chars, streamed)`);
  return responseText.trim();
}

/** Deterministic fallback — instant, always succeeds. */
async function emitFallbackSummary(input: EmitJobFinalSummaryInput): Promise<string> {
  const { completedTasks, touched, unresolved } = input;
  const lines: string[] = [];
  lines.push(
    completedTasks.length === 1
      ? `Completed 1 task: ${completedTasks[0].name}.`
      : `Completed ${completedTasks.length} tasks:`,
  );
  if (completedTasks.length > 1) {
    for (const t of completedTasks) {
      lines.push(`- ${t.type ? `[${t.type}] ` : ''}${t.name}`);
    }
  }
  if (touched) {
    const counts = `Files — created ${touched.created.length}, edited ${touched.edited.length}, deleted ${touched.deleted.length}.`;
    lines.push(counts);
  }
  if (unresolved?.length) {
    lines.push('Unresolved:');
    for (const u of unresolved) lines.push(`- ${u}`);
  }
  const text = lines.join('\n');
  await input.chatAPI.startMessage();
  await input.chatAPI.sendLLMEvent({ type: 'text', text });
  await input.chatAPI.finalizeMessage();
  console.log('📝 [JobSummary] emitted (deterministic fallback)');
  return text;
}

function buildTemplateVars(input: EmitJobFinalSummaryInput): Record<string, unknown> {
  const touched = input.touched ?? { created: [], edited: [], deleted: [] };
  const topPaths = [...touched.created, ...touched.edited, ...touched.deleted]
    .slice(0, TOP_PATHS_CAP)
    .join(', ');
  return {
    jobType: input.jobType,
    directive: input.directive || '(no directive)',
    additionalDirectives: (input.directives ?? []).filter((d) => d && d !== input.directive),
    tasks: input.completedTasks.map((t) => ({
      name: t.name,
      type: t.type ?? 'task',
      description: t.description ?? '',
      files: (t.files ?? []).slice(0, 8).join(', '),
    })),
    taskProse: input.taskProse ?? [],
    created: touched.created.length,
    edited: touched.edited.length,
    deleted: touched.deleted.length,
    topPaths,
    unresolved: input.unresolved ?? [],
  };
}

/**
 * Harvest the per-task user-facing prose of this turn (task_response card
 * bodies + assistant messages) as LLM input. Separate from the emit call so
 * the learn seam can pass it explicitly and tests can stub it.
 */
export async function harvestTaskProse(
  session: SessionPort | undefined,
  turnId: string | undefined,
): Promise<string[]> {
  if (!session || !turnId) return [];
  try {
    // Own budget: the learn seam awaits this inline, OUTSIDE the emit call's
    // timeout, so a hung chat-log read would block job completion unbounded.
    const lines = await withTimeout(
      session.loadChatByTurnIds([turnId]),
      TASK_PROSE_HARVEST_TIMEOUT_MS,
    );
    const parts: string[] = [];
    for (const line of lines) {
      const prose = assistantProseOf(line);
      if (prose) parts.push(prose.length > TASK_PROSE_CAP ? `${prose.slice(0, TASK_PROSE_CAP)}…` : prose);
    }
    return parts;
  } catch (err) {
    console.warn('⚠️  [JobSummary] task-prose harvest failed:', err);
    return [];
  }
}

/** `onTimeout` fires before the rejection so callers can mark work abandoned. */
function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout?: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => {
      onTimeout?.();
      reject(new Error(`job summary timeout after ${ms}ms`));
    }, ms);
    promise.then(
      (v) => { clearTimeout(id); resolve(v); },
      (e) => { clearTimeout(id); reject(e); },
    );
  });
}
