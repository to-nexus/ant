/**
 * Execute Node (Planner Job)
 *
 * The authoring phase. Consumes ONLY `directive + planText` on a fresh
 * NODE_EXECUTE channel — the plan-loop research transcript is severed, so the
 * research momentum / auditor-persona tail that used to drift the monolith
 * never reaches authoring. Streams the document (`<file>` in generate mode,
 * `edit_file` in refactor mode), writes to disk, records the session run, and
 * finalizes inline (no `learn` tail node).
 *
 * There is no clarify here — clarify lives in the plan node. There is no
 * authoring-turn self-loop (plan-job-valiant-pebble) — the context is already
 * clean and re-anchored, so a missing `<file>` in generate mode is a genuine
 * terminal error.
 */

import * as path from 'path';
import * as fsPromises from 'fs/promises';
import { PlanGraphState, getPlanMode } from '../../state';
import { CONV_KEYS, getConv, type ConversationMessage } from '../../../../../common/graph/conversations';
import {
  extractTokenUsageFromStreamEvent,
  accumulateTokenUsage,
  upsertPhaseTokenUsage,
  maybeUpdatePhaseTokenUsage,
  applyEstimatedInputTokensFromMessages,
  broadcastTokenUsageByModel,
} from '../../../../../common/graph/llmHelpers';
import { getChatAPIClient } from '../../../../../../core/adapters/ChatAPIClient';
import { TEMPLATE_PATHS } from '../../../../../../core/prompt/builder/templatePaths';
import { v4 as uuidv4 } from 'uuid';
import { plannerToolsForMode } from '../tools';
import { getEstimatingLabel } from '../../../../../common/graph/timing/estimatingLabels';
import { StreamOrchestrator } from '../../../../../../core/streaming/StreamOrchestrator';
import { XMLStreamParser } from '../../../../../../core/streaming/parsers/XMLStreamParser';
import { CommonRenderStrategy } from '../../../../../../core/streaming/strategies/CommonRenderStrategy';
import { buildAssistantMessage } from '../../../../../common/tool/messageBuilder';
import { maybeJoinSubagents, ownerKeyFor } from '../../../../../common/subagent';
import { logPrompt } from '../../../../../../core/utils/promptLogger';
import { PLAN_CONVERSATION_HISTORY_BUDGET } from '../../../../../../core/context';
import { buildCacheableBlocks } from '../../../../../../core/prompt/builder/CacheBlockMapper';
import { composeMessages } from '../../../../../../core/utils/messageComposer';
import { TokenBudgetManager } from '../../../../../../core/utils/tokenBudget';
import { LLM_MAX_TOKENS, LLM_TEMPERATURE } from '../../../../../common/graph/llmConfig';
import { extractLLMInfo } from '../../../../../../core/ports/workflow';
import { buildExecuteSystemPrompt } from './buildSystemPrompt';
import { getTargetPath } from '../plan/buildSystemPrompt';
import { saveConversationToSession, isSafeStagingPath } from '../sessionWriter';

export function buildAuthoringMessage(directive: string, targets: string[], mode: string, isKorean: boolean): string {
  const primary = targets[0] ?? '';
  if (mode === 'refactor') {
    return isKorean
      ? `아래 지시에 따라 \`${primary}\` 문서를 편집하세요. 시스템 프롬프트의 브리프가 편집 범위의 근거입니다. \`edit_file\`로 범위 내 변경만 적용하세요.\n\n지시(원문):\n${directive}`
      : `Apply the scoped edit to \`${primary}\` per the directive below. The brief in the system prompt is the edit-scope anchor. Use \`edit_file\` for the in-scope change only.\n\nDirective (verbatim):\n${directive}`;
  }
  if (targets.length > 1) {
    const list = targets.join(', ');
    return isKorean
      ? `아래 지시에 따라 기획 문서들을 작성하세요. 시스템 프롬프트의 브리프(관찰/결정 사항)를 근거로 삼되, 그대로 옮기지 말고 문서 섹션으로 변환하세요. 다음 파일들을 **각각 하나의 \`<file path="...">\` 태그**로 출력하고, 섹션을 파일 간 겹치지 않게(MECE) 배분하세요 — 각 파일은 완결되어야 합니다: ${list}\n\n지시(원문):\n${directive}`
      : `Author the planning documents per the directive below. Use the brief in the system prompt (observations/decisions) as your anchor, but do NOT reproduce it verbatim — transform it into document sections. Emit **one \`<file path="...">\` tag per file** for exactly these files, partitioning the sections across them with NO overlap (MECE) — each file must be complete: ${list}\n\nDirective (verbatim):\n${directive}`;
  }
  return isKorean
    ? `아래 지시에 따라 기획 문서를 작성하세요. 시스템 프롬프트의 브리프(관찰/결정 사항)를 근거로 삼되, 브리프나 분석 내용을 그대로 옮기지 말고 문서 섹션으로 변환하세요. 완성된 문서 전체를 하나의 \`<file path="${primary}">\` 태그 안에 출력하세요.\n\n지시(원문):\n${directive}`
    : `Author the planning document per the directive below. Use the brief in the system prompt (observations/decisions) as your anchor, but do NOT reproduce the brief or any analysis verbatim — transform it into the document's sections. Emit the complete document inside a single \`<file path="${primary}">\` tag.\n\nDirective (verbatim):\n${directive}`;
}

export async function executeNode(state: PlanGraphState): Promise<Partial<PlanGraphState>> {
  const recursionCount = (state.recursionCount || 0) + 1;
  const planMode = getPlanMode(state);
  console.log(`\n✍️  [Planner:Execute] Authoring document... (iteration ${recursionCount}/${state.recursionLimit})`);

  if (state.deps?.kanbanUpdate?.setEstimatingActivity) {
    state.deps.kanbanUpdate.setEstimatingActivity(getEstimatingLabel('planExecute', state._uiLocale || 'en'), 'execute');
  }

  // Per-node model: execute authors from the sealed brief → Sonnet
  // (llmModels.plan.execute = job default), falling back to `llm` when unset.
  const llm = state.deps?.executeLlm ?? state.deps?.llm;
  if (!llm) throw new Error('LLM is required for execute node');

  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.enterNode(
      state._httpJobId, 'execute', 0,
      undefined, extractLLMInfo(llm),
      recursionCount, state.recursionLimit,
    );
  }

  const built = await buildExecuteSystemPrompt(state);
  const systemPrompt = built.prompt;

  if (state._httpJobId && state.featurePath) {
    try {
      await logPrompt(
        state.featurePath, state._httpJobId, 'plan', 'execute',
        systemPrompt.length,
        {
          templatePath: TEMPLATE_PATHS.plannerExecute.base,
          usedTemplates: [
            TEMPLATE_PATHS.plannerExecute.base,
            TEMPLATE_PATHS.plannerExecute.rules!,
            ...built.injectedTemplates,
          ],
          injectedVariables: {
            directive: state.directive || '',
            mode: planMode,
            targets: state.resolvedAction?.target || [],
            domain: state.resolvedAction?.domain ?? '(unset)',
            basisInjected: built.basisInjected,
            hasPlanText: !!state.planText,
            planTextLen: state.planText?.length ?? 0,
            recursionCount,
          },
        },
      );
    } catch (err) {
      console.warn(`⚠️ [Planner:Execute] Failed to log prompt:`, err);
    }
  }

  // Build messages via the shared cache-aware composer (single owner — same
  // path code/design execute use). The stable system + injections sections
  // become `cache_control`-marked leading blocks so the prompt prefix is
  // cached across execute → tool → execute re-entries instead of re-sent cold
  // as a plain `system` string. On fresh entry the authoring message
  // (directive + brief anchor) is appended as an uncached Block 3 part; on
  // re-entry the pruned NODE_EXECUTE history rides as prior turns
  // (composeMessages runs the same `compactRun` pruning as before).
  const nodeExecute = getConv(state.conversations, CONV_KEYS.NODE_EXECUTE);
  const targetPaths = state.resolvedAction?.target ?? [];
  const targetPath = getTargetPath(state) || '';
  const initialBlocks = buildCacheableBlocks(built.result, {
    runtimeParts: nodeExecute.length === 0
      ? [buildAuthoringMessage(state.directive || '', targetPaths, planMode, state.language === 'ko')]
      : undefined,
  });
  const execTokenManager = new TokenBudgetManager({
    areaBudgets: {
      systemPrompt: 30_000,
      projectContext: 30_000,
      taskContext: 25_000,
      conversationHistory: PLAN_CONVERSATION_HISTORY_BUDGET,
    },
  });
  const { messages } = composeMessages({
    initialBlocks,
    priorTurns: nodeExecute as any,
    tokenManager: execTokenManager,
  });

  // generate → `<file>` write path (no edit_file); refactor → edit_file.
  const activeTools = plannerToolsForMode(planMode);
  const toolDefinitions = activeTools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters }));

  const chatAPI = getChatAPIClient();
  const parser = new XMLStreamParser();
  const renderStrategy = new CommonRenderStrategy(
    chatAPI, state.language === 'ko' ? 'ko' : 'en', undefined, undefined, false, 'plan',
  );
  const orchestrator = new StreamOrchestrator({ parser, renderStrategy, existingFiles: new Set() });

  let responseText = '';
  const toolCalls: Array<{ id: string; name: string; args: Record<string, any> }> = [];
  const isFirstCall = nodeExecute.length === 0;

  await chatAPI.showChatStatus('placeholder');

  try {
    applyEstimatedInputTokensFromMessages(state as any, messages);
    for await (const event of llm.stream(messages, {
      tools: toolDefinitions,
      maxTokens: LLM_MAX_TOKENS.DEFAULT,
      temperature: LLM_TEMPERATURE.DOC_GENERATION,
      enableThinking: isFirstCall,
    })) {
      if (event.type === 'retry') {
        responseText = '';
        toolCalls.length = 0;
        continue;
      }
      maybeUpdatePhaseTokenUsage(state, event);
      await orchestrator.processEvent(event);
      if (event.type === 'text' && event.text) responseText += event.text;
      if (event.type === 'tool_use' && event.toolUse) {
        const { id, name, input } = event.toolUse;
        await chatAPI.sendLLMEvent(event);
        toolCalls.push({ id: id || uuidv4(), name, args: input });
      }
      if (event.type === 'done') {
        const capturedUsage = extractTokenUsageFromStreamEvent(event);
        if (capturedUsage) {
          accumulateTokenUsage(state, capturedUsage, { taskLevel: false, jobLevel: true, modelId: (llm as any).modelName });
          upsertPhaseTokenUsage(state, 'execute', capturedUsage);
        }
        if (state.deps?.kanbanUpdate?.updateTaskQueue && state._httpJobId) {
          broadcastTokenUsageByModel(state as any);
          state.deps.kanbanUpdate.updateTaskQueue(
            state._httpJobId, null, [], [], recursionCount, state.recursionLimit, state.tokenUsage,
          );
        }
        if (state.phaseTokenUsages && state.deps?.kanbanUpdate?.updatePhaseTokenUsages) {
          state.deps.kanbanUpdate.updatePhaseTokenUsages(state.phaseTokenUsages);
        }
      }
    }
  } catch (error: any) {
    console.error(`❌ [Planner:Execute] LLM error: ${error.message}`);
    throw error;
  }

  const updatedHistory: ConversationMessage[] = [...nodeExecute];
  if (nodeExecute.length === 0) {
    updatedHistory.push({ role: 'user', content: buildAuthoringMessage(state.directive || '', targetPaths, planMode, state.language === 'ko') });
  }

  // ── Tool-call round: short-circuit to the tool node (stay in execute loop) ──
  if (toolCalls.length > 0) {
    await orchestrator.finalize(true);
    if (state.deps?.workflowUpdate && state._httpJobId) {
      state.deps.workflowUpdate.exitNode(state._httpJobId, 'execute', 0);
    }
    updatedHistory.push(buildAssistantMessage({ text: responseText || undefined, toolCalls }) as ConversationMessage);
    if (state.deps?.stateSnapshot) {
      state.deps.stateSnapshot.conversations = { ...state.conversations, [CONV_KEYS.NODE_EXECUTE]: updatedHistory };
      state.deps.stateSnapshot.tokenUsage = state.tokenUsage;
    }
    return {
      conversations: { [CONV_KEYS.NODE_EXECUTE]: updatedHistory },
      pendingToolCalls: toolCalls,
      tokenUsage: state.tokenUsage,
      tokenUsageByModel: state.tokenUsageByModel,
      recursionCount,
      _activePhase: 'execute',
      _subagentJoinRedo: false,
    };
  }

  await orchestrator.finalize(true);

  // ── Join barrier (explore subagent): the LLM finished authoring while
  // reports are still owed. Withhold finalization (no disk write yet),
  // deliver the reports as a user turn, and re-enter execute so the final
  // document incorporates them.
  {
    const subagentOwnerKey = ownerKeyFor(state._httpJobId);
    // No hasPending pre-gate — settled-but-undelivered reports must join too.
    {
      const joined = await maybeJoinSubagents(state as any, subagentOwnerKey, { history: updatedHistory });
      if (joined) {
        updatedHistory.push({
          role: 'assistant',
          content: responseText || '(finalization withheld — subagent reports pending)',
        });
        updatedHistory.push({
          role: 'user',
          content: [
            ...joined.blocks,
            {
              type: 'text',
              text: 'All pending subagent reports are delivered above. Incorporate them and emit your final document now.',
            },
          ] as any,
        });
        if (state.deps?.workflowUpdate && state._httpJobId) {
          state.deps.workflowUpdate.exitNode(state._httpJobId, 'execute', 0);
        }
        console.log(`🔀 [Planner:Execute] Finalization withheld — subagent reports delivered, re-entering execute`);
        return {
          conversations: { [CONV_KEYS.NODE_EXECUTE]: updatedHistory },
          pendingToolCalls: [],
          tokenUsage: state.tokenUsage,
          tokenUsageByModel: state.tokenUsageByModel,
          recursionCount,
          _activePhase: 'execute',
          _subagentJoinRedo: true,
          ...(joined.tokenDelta as any),
        };
      }
    }
  }

  // ── Authoring done — extract the document(s), write to disk, record session.
  //    Generate mode may emit MULTIPLE `<file>` tags (a MECE plan split); write
  //    every recognized file. Bound targets accept only files whose basename
  //    matches a declared target (honoring the plan/ dir); unbound accepts any
  //    safe LLM-emitted path (dusk-mounding-pilot fallback). ──
  const boundTargets = state.resolvedAction?.target ?? [];
  const writtenFiles: Array<{ relPath: string; content: string }> = [];
  let resolvedTargetRelPath = getTargetPath(state);
  let generatedDocument: string | undefined;

  if (planMode !== 'refactor') {
    const files = orchestrator.getRegistry().getAllFiles().filter(f => (f.content ?? '').trim().length > 0);
    const boundByBasename = new Map(boundTargets.map(t => [path.basename(t), t]));
    for (const f of files) {
      let relPath: string | undefined;
      if (boundByBasename.size > 0) {
        relPath = boundByBasename.get(path.basename(f.path));
      } else if (isSafeStagingPath(f.path)) {
        relPath = f.path; // unbound — accept any safe LLM-emitted path
      }
      if (!relPath) {
        console.warn(`⚠️ [Planner:Execute] Skipping <file> "${f.path}" — not a declared target / unsafe path.`);
        continue;
      }
      writtenFiles.push({ relPath, content: f.content });
    }
    generatedDocument = writtenFiles.length > 0 ? writtenFiles.map(w => w.content).join('\n\n') : undefined;
  } else if (resolvedTargetRelPath) {
    // refactor: edits were applied via edit_file; read back the file for session metadata.
    const editTargetPath = path.join(state.featurePath, resolvedTargetRelPath);
    try {
      generatedDocument = await fsPromises.readFile(editTargetPath, 'utf-8');
      if (generatedDocument) writtenFiles.push({ relPath: resolvedTargetRelPath, content: generatedDocument });
    } catch {
      console.log(`📝 [Planner:Execute] No target file found (no edits made)`);
    }
  }

  if (writtenFiles.length > 0 && planMode !== 'refactor') {
    if (state.deps?.kanbanUpdate?.setEstimatingActivity) {
      state.deps.kanbanUpdate.setEstimatingActivity(getEstimatingLabel('write', state._uiLocale || 'en'), 'write');
    }
    for (const { relPath, content } of writtenFiles) {
      const targetAbsPath = path.join(state.featurePath, relPath);
      try {
        await fsPromises.mkdir(path.dirname(targetAbsPath), { recursive: true });
        await fsPromises.writeFile(targetAbsPath, content, 'utf-8');
        console.log(`📝 [Planner:Execute] Written ${content.length} chars to ${relPath}`);
      } catch (error: any) {
        console.error(`❌ [Planner:Execute] Failed to write document: ${error.message}`);
        throw error;
      }
      notifyFileTree(state, relPath);
    }
    resolvedTargetRelPath = writtenFiles[0].relPath; // primary for session record
  }

  if (generatedDocument && resolvedTargetRelPath) {
    // One run entry per turn (combined char count); refine-impact per doc.
    await recordSessionRun(state, planMode, resolvedTargetRelPath, generatedDocument);
    for (const { relPath } of writtenFiles) {
      await emitRefineImpactIfPrd(state, planMode, relPath, responseText);
    }
  }

  // Writer integrity guard — in generate mode at least one `<file>` MUST have
  // been emitted. The context is clean and re-anchored, so a miss is a genuine
  // terminal error (no authoring-turn self-loop — that was the monolith's crutch).
  if (writtenFiles.length === 0 && planMode === 'generate') {
    const missTarget = resolvedTargetRelPath ?? '(unresolved)';
    console.error(
      `❌ [Planner:Execute] NO <file> artifact for target "${missTarget}" — response was not wrapped in a <file> tag. Nothing written to disk.`,
    );
    try {
      const notice = state.language === 'ko'
        ? `\n\n> ⚠️ 문서가 저장되지 않았습니다 — 응답이 \`<file>\` 형식으로 출력되지 않았습니다. 다시 시도해 주세요.`
        : `\n\n> ⚠️ No document was saved — the response was not emitted as a \`<file>\` document. Please try again.`;
      await chatAPI.sendLLMEvent({ type: 'text', text: notice });
    } catch (err) {
      console.warn(`⚠️ [Planner:Execute] Failed to surface no-artifact notice:`, err);
    }
  }

  await chatAPI.finalizeMessage();
  if (state.deps?.workflowUpdate && state._httpJobId) {
    state.deps.workflowUpdate.exitNode(state._httpJobId, 'execute', 0);
  }

  updatedHistory.push({ role: 'assistant', content: responseText });
  const finalHistory = [...updatedHistory];
  await saveConversationToSession(state, {
    nodeKey: CONV_KEYS.NODE_EXECUTE,
    responseText,
    generatedDocument,
    nodeHistory: finalHistory,
  });

  return {
    conversations: { [CONV_KEYS.NODE_EXECUTE]: updatedHistory },
    pendingToolCalls: [],
    tokenUsage: state.tokenUsage,
    tokenUsageByModel: state.tokenUsageByModel,
    recursionCount,
    _subagentJoinRedo: false,
  };
}

/** Router: decide next node after execute. */
export function routeAfterExecute(state: PlanGraphState): 'tool' | 'execute' | '__end__' {
  if (state._subagentJoinRedo) return 'execute';
  if (state.pendingToolCalls && state.pendingToolCalls.length > 0) return 'tool';
  return '__end__';
}

// ── helpers salvaged from the old generate node ──

function notifyFileTree(state: PlanGraphState, relPath: string): void {
  if (!state.deps?.fileTreeUpdate) return;
  const projectId = process.env.ANT_PROJECT_ID;
  const featureName = process.env.ANT_FEATURE_NAME;
  if (!projectId || !featureName) {
    console.warn(`⚠️ [Planner:Execute] Cannot notify file tree: missing ANT_PROJECT_ID or ANT_FEATURE_NAME`);
    return;
  }
  try {
    state.deps.fileTreeUpdate.notifyFileTreeUpdate(projectId, featureName);
    if ('addUnseenArtifacts' in state.deps.fileTreeUpdate) {
      (state.deps.fileTreeUpdate as any).addUnseenArtifacts(projectId, featureName, [relPath]);
    }
  } catch (error: any) {
    console.warn(`⚠️ [Planner:Execute] Failed to notify file tree update: ${error.message}`);
  }
}

async function recordSessionRun(
  state: PlanGraphState,
  planMode: string,
  relPath: string,
  generatedDocument: string,
): Promise<void> {
  try {
    const session = state.deps?.session;
    if (!session) return;
    const projectId = session.projectId || process.env.ANT_PROJECT_ID || 'default';
    const featureName = session.featureName || process.env.ANT_FEATURE_NAME || 'skeleton';
    const now = new Date().toISOString();
    // Carry the jobId so this run is a Job-tab-visible entry (the /jobs endpoint
    // skips runs without a jobId).
    await session.addRun(projectId, featureName, 'plan', {
      runId: 0,
      job: 'plan',
      timestamp: now,
      jobId: state._httpJobId,
      status: 'completed',
      completedAt: now,
      input: {
        type: 'directive',
        source: planMode === 'refactor' ? state.resolvedAction?.target?.[0] : undefined,
        summary: (state.directive || '').substring(0, 200),
      },
      output: {
        planSummary: `${planMode} completed (${generatedDocument.length} chars)`,
      },
    });
  } catch (error: any) {
    console.warn(`⚠️ [Planner:Execute] Failed to record session: ${error.message}`);
  }
}

async function emitRefineImpactIfPrd(
  state: PlanGraphState,
  planMode: string,
  relPath: string,
  responseText: string,
): Promise<void> {
  if (planMode !== 'refactor') return;
  // Any revised plan document under `plan/` cascades — not only `prd.md`.
  if (!/^plan\/[^/]+\.md$/.test(relPath)) return;
  try {
    const { emitRefineImpactAlert } = await import('../../../../../../core/refine/refineImpactAlert');
    await emitRefineImpactAlert({
      featurePath: state.featurePath,
      updatedDoc: path.basename(relPath),
      llmResponse: responseText,
      directive: state.directive,
    });
  } catch (error: any) {
    console.warn(`⚠️ [Planner:Execute] Failed to emit refine impact alert: ${error?.message ?? error}`);
  }
}
