/**
 * Tool Node (Code Job)
 *
 * Uses createToolNode factory from common/tool/.
 * Code-specific logic (verificationTracker, commandHistory,
 * plan/execute dual history) is handled via hooks.
 * Execute/plan nodes push assistant messages; this node appends tool_result only.
 */

import { ArchitectGraphState } from '../../state';
import { CONV_KEYS, getConv } from '../../../../../common/graph/conversations';
import { toolResultManager } from './utils/managers';
import { buildTaskReminder, updateCommandHistory } from './utils/helpers';
import { recordServerStarted } from './utils/serverTracking';
import { createToolNode } from '../../../../../common/tool/createToolNode';
import { createCodeToolRegistry } from '../../../../../common/tool/presets';
import { computeRacScope, decideRacGate } from '../decompose/racGate';
import { createChatStatusReporter } from '../../../../../common/tool/chatStatusAdapter';
import type { ToolExecutionContext, ToolExecutionEvent } from '../../../../../common/tool/types';
import { hooksIfActive } from '../../tasks/_shared/registry';
import { isVerifyModeActive } from '../../tasks/_shared/verify';
import { allowsPersistentProcesses } from '../../tasks/_shared/verify/persistentProcessGate';
import { getExecutionLogger } from '../../../../../../core/utils/executionLogger';

const registry = createCodeToolRegistry();

const toolNodeFn = createToolNode<ArchitectGraphState>({
  getPendingCalls(state) {
    return (state.llmResponse?.toolCalls || []).map(tc => ({
      id: tc.id,
      name: tc.name,
      args: tc.args,
    }));
  },

  // RAC-scope gate for plan/execute on-demand file reads — the single
  // code-job seam serving BOTH phases (they share this `tool` node). Mirrors
  // the decompose inline gate so the RAC boundary is symmetric: explicit
  // pipelines may read only inside `refs ∪ context` (plus codebase/, which
  // `decideRacGate` treats as orthogonal); infer pipelines (racScope=undefined)
  // allow everything. Only file-access tools carry a single artifact path.
  // Common handlers stay RAC-orthogonal — the policy lives here, not in them.
  gateCall(state, call) {
    if (call.name !== 'read_file' && call.name !== 'list_files') return { allowed: true };
    const racScope = computeRacScope(state.resolvedAction);
    if (!racScope) return { allowed: true };
    const target = ((call.args as any)?.path ?? (call.args as any)?.directory ?? '') as string;
    return decideRacGate(target, racScope);
  },

  buildContext(state): ToolExecutionContext {
    return {
      fileSystem: state.deps?.fileSystem as any,
      chatStatus: createChatStatusReporter(),
      workingDir: state.context?.featurePath || process.cwd(),
      featurePath: state.context?.featurePath,
      project: state.context?.projectName,
      featureFolder: state.context?.featureFolder,
      command: state.deps?.command as any,
      git: state.deps?.git as any,
      redis: state.deps?.redis,
      fileTreeUpdate: state.deps?.fileTreeUpdate as any,
      figmaFileKey: state.figmaFileKey,
      activePhase: state._activePhase as 'plan' | 'execute' | undefined,
      // Codebase mutation gate — `execute` is the only phase that may
      // mutate `codebase/` paths. `plan` produces the sealed plan JSON;
      // source-code changes are deferred to execute.
      allowMutateInCodebase: state._activePhase === 'execute',
      // Shell execution gate — code job's normal workflow runs shell
      // commands in BOTH phases: plan tool-loop runs verification gates
      // (build / typecheck / test for the verification task), test
      // runner installs (test-code task), error diagnostics (error
      // task), and dependency probes (default plan); execute applies
      // fixes. Always-true here is the SSOT — the orthogonal mutate
      // gate above is what keeps plan from writing source code.
      allowShellExecution: true,
      currentTaskType: (state.currentTask as any)?.type,
      // Verify-mode dispatch is signalled by `verifyModeActive` below
      // (`requiresVerification(task) && _verifyEntered`). Apply-phase
      // command guards no longer need the selfVerifyOnDone flag because
      // gate commands are uniformly blocked in apply phase (the verify
      // cycle re-runs them in reverify).
      // Batch-split sub-tasks carry a non-empty `prePlanText` injected by
      // `processDiagnosticBatchSplit`. Surface this as a flat flag so
      // task-type command guards (test-code install block) can reject
      // shared-state mutations without pulling the whole task into the
      // common tool layer.
      currentTaskHasPrePlanText:
        typeof (state.currentTask as any)?.prePlanText === 'string' &&
        ((state.currentTask as any).prePlanText as string).length > 0
          ? true
          : undefined,
      // Verify-mode active flag — set when the current task is a verification
      // responsibility holder AND `_verifyEntered === true`. Command-policy
      // guards use this to differentiate apply-phase callers from
      // verification cycles (Go build allow-list, etc.).
      verifyModeActive: isVerifyModeActive(state),
      // Persistent-process / http_request gate — SSOT predicate (error task or
      // runtime-error verification). Defence-in-depth: the http_request handler
      // hard-rejects when false, mirroring the tool selectors that hide it.
      allowPersistentProcesses: allowsPersistentProcesses(state),
      // Read-only snapshot so the http_request handler can auto-target the
      // most-recent keep_running server's port without importing graph state.
      runningServers: state.runningServers,
      retries: state.retries,
      referenceRequests: state.referenceRequests,
      resolvedActionMode: state.resolvedAction?.mode,
      retriever: state.deps?.retriever as any,
      vectorDB: state.deps?.vectorDB,
      workspaceResolver: state.deps?.workspaceResolver,
      userId: state.context?.userId,
      organizationId: state.context?.organizationId,
      // Phase 3-15 — surface plan-phase search_web usage to the handler.
      planSearchWebCount: state._planSearchWebCount ?? 0,
      planSearchWebLimit: parseInt(process.env.ANT_PLAN_SEARCH_WEB_MAX || '3', 10),
      // Per-task touched-files SSOT. chat.jsonl file_* events are ephemeral
      // UI feed — the durable record lives on `currentTask.touchedFiles`
      // and persists into `code.json.state.completedTasksDetails[i]` when
      // `checkTaskStatus` pushes the completed task. Readers: learn node
      // (lessonMetadata.relatedFiles / SessionRun.output.files).
      recordFileTouch: (_op, p) => {
        if (!state.currentTask) return;
        const arr = (state.currentTask.touchedFiles ??= []);
        if (!arr.includes(p)) arr.push(p);
      },
    };
  },

  registry,
  resultManager: toolResultManager,

  getHistory(state) {
    return state._activePhase === 'plan'
      ? getConv(state.conversations, CONV_KEYS.NODE_PLAN)
      : getConv(state.conversations, CONV_KEYS.NODE_EXECUTE);
  },

  hooks: {
    afterExecution(state, event) {
      // NOTE: chat.jsonl `chat_status` lines (statusType=file_create /
      // file_edit / file_delete + failed variants) are emitted by
      // `FileOperationHandler.addFileOperation` (SSOT) when tool handlers
      // call `ctx.chatStatus.completeFileCreation/Edit/Deletion`. No
      // separate emission is needed here.
      // R1 — task-type-specific side-effect handling lives on the task's
      // tool hook (verification: gate invalidation / install status / deep-
      // diagnostic marking via the Session API). The inline switch below
      // owns only phase-blind bookkeeping (command history) that the hook
      // layer does not mediate. `_lastToolBatchMutatedFiles` is computed in
      // `buildReturn` from `executionEvents` and returned as a state
      // update so LangGraph's `LastValue` reducer commits it to the graph
      // state — direct `state.X = true` mutation never propagates via the
      // Annotation channel. The same applies to `_planSearchWebCount`
      // (Phase 3a): bumped via `afterBatch` → `hookUpdates` → `buildReturn`
      // so the reducer actually commits it.
      hooksIfActive(state)?.tool?.onEvent(state, event);

      // Stage 0.1 — tool_call trace (args + sideEffects); non-blocking.
      // Static import + synchronous writeQueue update — see executionLogger
      // contract (vast-curling-perch C-3 RCA).
      if (state.context?.featurePath && state._httpJobId && state.currentTask) {
        const content = event.result.content;
        const isMultimodal = Array.isArray(content);
        const resultStr = isMultimodal
          ? `[multimodal: ${content.length} blocks]`
          : (typeof content === 'string' ? content : JSON.stringify(content ?? ''));
        void getExecutionLogger({
          featurePath: state.context.featurePath,
          jobId: state._httpJobId,
          jobType: 'code',
        })
          .logToolCall(state.currentTask.id, {
            toolName: event.toolName,
            args: event.args,
            resultChars: resultStr.length,
            resultPreview: resultStr.length <= 500 ? resultStr : undefined,
            wasTruncated: false,
            error: event.result.error,
            // Surface 'verify' in the debug log when verification is active,
            // even though the graph's `_activePhase` channel stays 'plan'
            // (verification loops live inside the plan node). Downstream
            // consumers of `activePhase` still see 'plan' | 'execute' via
            // the ToolExecutionContext; this is a log-only refinement so
            // debug traces accurately reflect which phase actually ran.
            phase: (isVerifyModeActive(state)
              ? 'verify'
              : state._activePhase) as 'plan' | 'execute' | 'verify' | undefined,
            sideEffects: event.result.sideEffects as Array<Record<string, any>> | undefined,
          })
          .catch(() => { /* non-blocking */ });
      }

      const effects = event.result.sideEffects || [];
      for (const effect of effects) {
        switch (effect.type) {
          case 'commandExecuted': {
            const { exitCode, command, success } = effect;
            const commandExecuted = { command, success, exitCode };
            const { shouldWarn, warningMessage } = updateCommandHistory(
              state, commandExecuted, event.result.error, event.result.content,
            );
            if (shouldWarn && warningMessage && typeof event.result.content === 'string') {
              event.result.content = event.result.content + warningMessage;
            }
            break;
          }
          case 'serverStarted': {
            // run_command emits this when LONG_RUNNING_PATTERNS matched and
            // the user passed `keep_running:true` (e.g. `npm run dev`,
            // `npx next dev`). Without this case the PID never reached
            // `state.runningServers`, so the learn-node teardown loop ran
            // against an empty array and detached children survived past
            // task completion — which is exactly the regression that broke
            // multi-frontend Preview restarts (`Another next dev server is
            // already running`). The contract in
            // persistent-process-policy.md states "the runtime tears the
            // process down on task completion"; this case fulfils the
            // tracking half of that contract, learn fulfils the killing half.
            //
            // The push/dedup/validation logic lives in `recordServerStarted`
            // (SSOT) so unit tests can pin the contract without standing up
            // the whole tool node.
            recordServerStarted(state, effect);
            break;
          }
        }
      }
    },

    afterBatch(state, events): Partial<ArchitectGraphState> {
      // Phase 3-15 / Phase 3a — count successful plan-phase search_web
      // invocations and emit the bumped counter via hookUpdates so
      // LangGraph commits it through the channel reducer. Mutating
      // `state._planSearchWebCount` from `afterExecution` did not
      // propagate (same latent-bug pattern as `_lastToolBatchMutatedFiles`).
      if (state._activePhase !== 'plan') return {};
      let bumps = 0;
      for (const e of events) {
        if (e.toolName === 'search_web' && !e.result.error) bumps += 1;
      }
      if (bumps === 0) return {};
      return { _planSearchWebCount: (state._planSearchWebCount ?? 0) + bumps };
    },

    buildExtraUserContent(state) {
      if (state._activePhase === 'plan') return [];
      const taskReminder = buildTaskReminder(state);
      if (!taskReminder) return [];
      return [{ type: 'text' as const, text: taskReminder }];
    },
  },

  buildReturn(state, { updatedHistory, executionEvents, hookUpdates }) {
    const allToolResults = executionEvents.map(e => {
      const isFigma = Array.isArray(e.result.content) &&
        e.result.content.some((b: any) => b.type === 'image');
      return {
        toolCallId: e.toolCallId,
        result: isFigma ? '[figma_image]' : e.result.content,
        error: e.result.error,
      };
    });

    // SSOT for `_lastToolBatchMutatedFiles` (turn-scoped): any execute-phase
    // tool invocation that mutated the filesystem (edit_file / create_file /
    // delete_file → `fileModified` / `fileCreated` / `fileDeleted` side
    // effects) flips the flag for the *single* execute turn that immediately
    // follows. Execute reads it in its `isStuckLooping` computation and
    // resets it to `false` on every return so a tool batch that mutated
    // files only counts once. Plan-phase tool batches never set this signal
    // — file mutations during plan-tool-loop are not execute-turn progress.
    //
    // Replaces the retired `_executeModifiedFiles` sticky flag whose dual
    // role (cross-cycle file change tracking AND turn-progress signal)
    // caused the `urban-fronting-faith` p2 reverify-branch lockout. The
    // cross-cycle semantics are now owned by LLM gate judgment plus the
    // `batch_cycle_limit` fail-safe.
    const MUTATION_SIDE_EFFECTS = new Set(['fileModified', 'fileCreated', 'fileDeleted']);
    const touchedFiles = state._activePhase !== 'plan' && executionEvents.some(e =>
      (e.result.sideEffects || []).some(ef => MUTATION_SIDE_EFFECTS.has(ef.type)),
    );

    const base: Partial<ArchitectGraphState> = {
      llmResponse: { ...state.llmResponse!, toolCalls: [] },
      toolResults: [...(state.toolResults || []), ...allToolResults],
      planText: state.planText,
      recursionCount: (state.recursionCount || 0) + 1,
      recursionLimit: state.recursionLimit,
      // Execute-phase tool batch only — plan-phase batches never touch this
      // signal, so a plan-tool-loop edit_file (which is rare but legal in
      // diagnostic exploration) does not mistakenly suppress a downstream
      // execute stuck-loop counter.
      ...(state._activePhase !== 'plan' ? { _lastToolBatchMutatedFiles: touchedFiles } : {}),
      ...hookUpdates,
    };

    if (state._activePhase === 'plan') {
      return { ...base, conversations: { [CONV_KEYS.NODE_PLAN]: updatedHistory } };
    }
    return { ...base, conversations: { [CONV_KEYS.NODE_EXECUTE]: updatedHistory } };
  },

  getWorkflowUpdate(state) {
    if (!state.deps?.workflowUpdate) return undefined;
    return {
      enterNode: state.deps.workflowUpdate.enterNode.bind(state.deps.workflowUpdate),
      exitNode: state.deps.workflowUpdate.exitNode.bind(state.deps.workflowUpdate),
    };
  },
  getHttpJobId(state) { return state._httpJobId; },
  getWorkerId(state) { return state.workerId ?? 0; },
  getTaskInfo(state) {
    if (!state.currentTask) return undefined;
    return {
      id: state.currentTask.id,
      name: state.currentTask.name,
      type: state.currentTask.type,
      description: state.currentTask.description,
      priority: state.currentTask.priority,
    };
  },
  getRecursionCount(state) { return state.recursionCount; },
  getRecursionLimit(state) { return state.recursionLimit; },
  getFigmaContext(_state) {
    return undefined;
  },
});

export async function tool(state: ArchitectGraphState): Promise<Partial<ArchitectGraphState>> {
  const { traceNodeEntry } = await import('../../../../../../utils/verificationTrace');
  traceNodeEntry('tool', state.currentTask ?? undefined);
  return toolNodeFn(state);
}
