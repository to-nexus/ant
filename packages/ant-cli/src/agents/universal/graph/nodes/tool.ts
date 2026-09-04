/**
 * Universal tool node — createToolNode factory binding.
 *
 * Dispatch: builtin catalog handlers + `mcp__{server}__{tool}` overlay
 * (registered into the registry at runner start). The per-call gate enforces:
 *   1. the custom job's `tools.builtin` allowlist (narrowing-only),
 *   2. the approval policy — Phase 1 is FAIL-CLOSED: an approval-gated call
 *      is rejected with guidance (never silently executed); the interactive
 *      approve/resume flow arrives with the approval UI,
 *   3. the @plan turn confinement — while turnContext.planTurn is set, file
 *      writes outside plan/ and execution tools (run_command / http_request /
 *      non-read-only MCP) are rejected: a plan turn produces a plan, not the
 *      work.
 *
 * Sandbox: ctx.fileSystem is the two-root facade (artifacts rw + definition
 * ro mount), pathAutoCorrect 'none' (no codebase/ prefixing).
 */

import { UNIVERSAL_FEATURE, isUniversalBuiltinTool } from '@ant/shared';
import type { UniversalGraphState, UniversalToolCall } from '../state';
import { CONV_KEYS, getConv } from '../../../common/graph/conversations';
import { createToolNode } from '../../../common/tool/createToolNode';
import { createChatStatusReporter } from '../../../common/tool/chatStatusAdapter';
import { ToolName, TOOL_SETS, CACHEABLE_TOOLS } from '../../../common/tool/toolCatalog';
import { getToolsByNames } from '../../../common/tool/toolSchemas';
import { createSubagentSeam } from '../../../common/subagent';
import type { ToolExecutionContext } from '../../../common/tool/types';
import { ToolResultManager } from '../../../../core/utils/toolResultManager';
import { TokenBudgetManager } from '../../../../core/utils/tokenBudget';
import { requireActiveCustomJob } from '../../../../core/customAgents/activeCustomJob';
import {
  requiresApproval,
  isExtensionToolName,
  planTurnViolation,
  isClarifyEnabled,
  UNIVERSAL_CLARIFY_BUDGET,
} from '../../../../core/customAgents/universalToolPolicy';
import { CLARIFY_TOOL_NAME, clarifyBlockFromArgs } from '../../../common/clarify/tool';
import { getUniversalMcp, getUniversalRegistry, UNIVERSAL_RESULT_LIMITS } from '../runtime';
import { projectHistoryTurns } from '../session/historyProjection';
import { clarifyPauseNode } from './clarifyPause';
import { approvalPauseNode } from './approvalPause';

const WRITE_SIDE_EFFECTS = new Set(['fileCreated', 'fileModified']);

/** Execution tools a @plan turn rejects outright (the write gate can't see their targets). */
const PLAN_TURN_EXECUTION_TOOLS = new Set<string>(['run_command', 'http_request']);

const PLAN_TURN_EXECUTION_ERROR = (name: string): string =>
  `"${name}" is blocked: this is a PLAN turn — no work is executed this turn. ` +
  `Write the plan document under plan/ or present the plan in chat; the actual work runs on a normal turn.`;

const universalResultManager = new ToolResultManager(new TokenBudgetManager(), UNIVERSAL_RESULT_LIMITS);

/**
 * Approval rejection — both builtin and extension tools. The error steers the
 * model; the notice is the user-visible half — without it the block surfaces
 * only as narration, and a run that needs the call parks on its stop hooks
 * with no visible cause. The deep link lands on the job.yaml whose
 * `tools.approval` is the one knob that unblocks it.
 *
 * Two flavors: interactive runs stay FAIL-CLOSED (the interactive approve
 * flow does not exist yet); an UNATTENDED (pipeline) run CAN pause for a
 * human — but only as the round's sole call, so the rejection instructs a
 * re-issue alone (the clarify sole-call discipline).
 */
function approvalRejection(
  toolName: string,
  resolved: { agentId: string; jobId: string },
  unattended: boolean,
): { allowed: false; error: string; notice: import('../../../common/tool/orchestrator').GateRejectionNotice } {
  return {
    allowed: false,
    error: unattended
      ? `"${toolName}" requires human approval. Re-issue this call ALONE (the only tool call of its round) — the run will pause and a person will approve or reject it from the pipeline inbox.`
      : `"${toolName}" requires user approval and the interactive approval flow is not available yet (fail-closed). ` +
        `Do NOT retry this call. Tell the user what you intended to do and ask them to either perform it themselves ` +
        `or have the job author declare \`tools.approval["${toolName}"]: never\` in job.yaml if it is safe to run unattended.`,
    notice: {
      content:
        `Approval required: "${toolName}" was not executed` +
        (unattended
          ? ' in this round (approval-gated calls pause the run only when issued alone).'
          : ` (approval-gated calls are refused when no one can approve). ` +
            `To let this job run it unattended, set tools.approval["${toolName}"]: never in job.yaml — or perform the action yourself.`),
      agentId: resolved.agentId,
      definitionPath: `jobs/${resolved.jobId}/job.yaml`,
    },
  };
}

/**
 * Would this call pass every gate EXCEPT the approval one? The pause wrapper
 * uses it: a call that is unknown/not allowlisted/plan-blocked must fall to
 * the inner node's instructive rejection, never pause a human for it.
 */
function callNeedsApprovalOnly(state: UniversalGraphState, call: { name: string; args: Record<string, any> }): boolean {
  const resolved = requireActiveCustomJob();
  if (call.name === CLARIFY_TOOL_NAME) return false;
  if (state.turnContext?.planTurn) return false; // plan turns reject execution/writes outright
  if (isExtensionToolName(call.name)) {
    const info = getUniversalMcp()?.getToolInfo(call.name);
    if (!info) return false;
    return requiresApproval(call.name, resolved.approval, { mcpReadOnlyHint: info.readOnlyHint });
  }
  if (!resolved.builtinTools.includes(call.name)) return false;
  return requiresApproval(call.name, resolved.approval);
}

/** Tool rounds without a `<checklist>` re-emit before the nudge fires (and its re-fire period). */
const CHECKLIST_NUDGE_STALE_ROUNDS = 3;

/**
 * Clarify availability RIGHT NOW (knob × session budget) — shared by the
 * pause-route predicate and the gateCall rejection wording. Mirrors the
 * agent node's advertisement gate; a call that fails this is stale session
 * memory (the tool was absent from this round's advertised list).
 */
export function isClarifyAllowedNow(state: UniversalGraphState): boolean {
  const resolved = requireActiveCustomJob();
  return (
    isClarifyEnabled(resolved, state.turnContext?.intents ?? ['general']) &&
    (state.clarifyRoundsUsed ?? 0) < UNIVERSAL_CLARIFY_BUDGET
  );
}

// Exported for the tool-policy reconciliation test (preset ↔ runtime wiring).
export const universalToolNodeConfig: import('../../../common/tool/createToolNode').ToolNodeConfig<UniversalGraphState> = {
  getPendingCalls(state) {
    return (state.pendingToolCalls || []).map((tc) => ({ id: tc.id, name: tc.name, args: tc.args }));
  },

  gateCall(state, call) {
    const resolved = requireActiveCustomJob();

    // Clarify is a control tool, not a work tool — a call reaching this gate
    // is always rejected with guidance: the pause path is the wrapper's
    // (sole allowed call of the round, valid args).
    if (call.name === CLARIFY_TOOL_NAME) {
      if (!isClarifyAllowedNow(state)) {
        return {
          allowed: false,
          error:
            'The clarify tool is not available in this session (disabled by the job definition or the question budget is spent). ' +
            'Do NOT retry it. Proceed with the most reasonable default and state the assumption you made.',
        };
      }
      const block = clarifyBlockFromArgs(call.args);
      if (typeof block === 'string') {
        return {
          allowed: false,
          error: `Invalid clarify call: ${block} Re-issue clarify ALONE with a valid question — or proceed with a sensible default and state the assumption.`,
        };
      }
      return {
        allowed: false,
        error:
          'clarify must be the ONLY tool call of its round. Act on the other tool results first, ' +
          'then re-issue clarify alone — or proceed with sensible defaults and state the assumption.',
      };
    }

    if (isExtensionToolName(call.name)) {
      const info = getUniversalMcp()?.getToolInfo(call.name);
      if (!info) {
        return { allowed: false, error: `Unknown tool "${call.name}" — it is not provided by any connected MCP server or declared API.` };
      }
      if (state.turnContext?.planTurn && info.readOnlyHint !== true) {
        return { allowed: false, error: PLAN_TURN_EXECUTION_ERROR(call.name) };
      }
      if (requiresApproval(call.name, resolved.approval, { mcpReadOnlyHint: info.readOnlyHint })) {
        // One-turn grant: the human just approved exactly this tool.
        if (state._approvalGrantTool === call.name) return { allowed: true };
        return approvalRejection(call.name, resolved, state._unattended === true);
      }
      return { allowed: true };
    }

    if (!resolved.builtinTools.includes(call.name)) {
      // A name that is no builtin at all must not be reported as one the job
      // merely failed to enable — allowlisting it cannot work. `checklist` is
      // the name the runtime's own checklist contract primes, so it earns the
      // one clause that says where the block actually goes.
      if (!isUniversalBuiltinTool(call.name)) {
        return {
          allowed: false,
          error: call.name === 'checklist'
            ? 'There is no "checklist" tool — the checklist is a `<checklist>` block in your streamed text, not a tool call. Emit it as text.'
            : `Unknown tool "${call.name}" — it is not a builtin, an MCP tool, or a declared API. Available: ${resolved.builtinTools.join(', ')}.`,
        };
      }
      return {
        allowed: false,
        error: `Tool "${call.name}" is not in this job's allowlist (tools.builtin). Available: ${resolved.builtinTools.join(', ')}.`,
      };
    }

    if (state.turnContext?.planTurn) {
      if (PLAN_TURN_EXECUTION_TOOLS.has(call.name)) {
        return { allowed: false, error: PLAN_TURN_EXECUTION_ERROR(call.name) };
      }
      const violation = planTurnViolation(call.name, call.args);
      if (violation) {
        return { allowed: false, error: violation };
      }
    }

    if (requiresApproval(call.name, resolved.approval)) {
      if (state._approvalGrantTool === call.name) return { allowed: true };
      return approvalRejection(call.name, resolved, state._unattended === true);
    }

    return { allowed: true };
  },

  buildContext(state) {
    const fileSystem = state.deps?.fileSystem;
    if (!fileSystem) throw new Error('[Universal:Tool] fileSystem dep is required');
    const ctx: ToolExecutionContext = {
      fileSystem,
      chatStatus: createChatStatusReporter(),
      workingDir: fileSystem.getRootPath(),
      featurePath: state.featurePath,
      project: state.projectId,
      // ToolOrchestrator gates its fileTree notify on project ∧ featureFolder —
      // universal's container rides the constant pseudo-feature, so artifact
      // writes (including mkdir and run_command) refresh the FE tree live.
      featureFolder: UNIVERSAL_FEATURE,
      // Artifact tree has no canonical codebase/ layout — resolve verbatim.
      pathAutoCorrect: 'none',
      // The whole tree is the sandbox; the codebase/ mutate gate is a
      // canonical-plane concept (a folder named "codebase/" here is just a
      // folder, e.g. an uploaded repo the user wants edited).
      allowMutateInCodebase: true,
      // run_command is approval-gated (fail-closed above); the shell gate
      // stays open so a declared-`never` command job can actually run.
      allowShellExecution: true,
      command: state.deps?.command,
      fileTreeUpdate: state.deps?.fileTreeUpdate,
      // read_state scope='history' — recall over the persisted session:main
      // originals that in-flight compaction folded (compaction works on a
      // throwaway copy). scope='run' stays the accurate "no tasks" stub:
      // universal has no TaskQueue, so completedTasks is deliberately unset.
      featureHistory: async () =>
        projectHistoryTurns(getConv(state.conversations, CONV_KEYS.SESSION_MAIN)),
    };
    ctx.subagent = createSubagentSeam({
      jobId: state._httpJobId,
      jobKind: 'universal',
      llmJobType: 'universal',
      baseCtx: ctx,
      registry: getUniversalRegistry(),
      childTools: getToolsByNames(TOOL_SETS.subagentUniversal),
      promptBuilder: state.deps?.promptBuilder,
    });
    return ctx;
  },

  hooks: {
    // Checklist recency nudge (clear-dotting-mouse): the checklist protocol is
    // sustained only by the model's own re-emission, and a long tool loop
    // starves it of recency — the contract lives in a static system band the
    // model stops attending to. Nudge only while unfinished items exist and
    // the list has gone stale, and only every Nth round, so quiet compliance
    // costs zero extra tokens.
    buildExtraUserContent(state) {
      const checklist = state.turnChecklist ?? state.restoredChecklist;
      if (!checklist?.items.some((i) => i.state !== 'done')) return [];
      const staleRounds = (state.recursionCount ?? 0) - (state._checklistEmitRound ?? 0);
      if (staleRounds < CHECKLIST_NUDGE_STALE_ROUNDS || staleRounds % CHECKLIST_NUDGE_STALE_ROUNDS !== 0) return [];
      return [{
        type: 'text' as const,
        text:
          '[checklist] The working checklist has not been re-emitted for several rounds. ' +
          'If any item is now complete, re-emit the FULL <checklist> block with updated marks ([x]/[~]/[ ]) in your next text — ' +
          'it is board-only, never shown in chat, and emitting it alone in a tool round is expected. ' +
          'If no item state changed, continue without emitting.',
      }];
    },
  },

  registry: getUniversalRegistry(),
  resultManager: universalResultManager,
  cacheableTools: CACHEABLE_TOOLS as ReadonlySet<string>,

  getHistory(state) {
    return getConv(state.conversations, CONV_KEYS.SESSION_MAIN);
  },

  getWorkflowUpdate(state) {
    return state.deps?.workflowUpdate;
  },
  getHttpJobId(state) {
    return state._httpJobId;
  },
  getRecursionCount(state) {
    return state.recursionCount;
  },
  getRecursionLimit(state) {
    return state.recursionLimit;
  },

  buildReturn(state, { updatedHistory, executionEvents }) {
    const toolCallRecords: UniversalToolCall[] = executionEvents.map((e) => ({
      name: e.toolName,
      args: e.args,
      result: typeof e.result.content === 'string' ? e.result.content : JSON.stringify(e.result.content),
      error: e.result.error,
      timestamp: Date.now(),
    }));

    // Real writes only (completion-signal = actual-write): collected from
    // side effects, consumed by the stop-hook gate (agent node), respond's
    // stop-hook recomputation, and the artifact manifest.
    const writes: string[] = [];
    for (const e of executionEvents) {
      for (const se of e.result.sideEffects ?? []) {
        if (WRITE_SIDE_EFFECTS.has(se.type) && 'path' in se && typeof se.path === 'string') {
          writes.push(se.path);
        }
      }
    }
    // delete_file / mkdir report differently; also count create/edit tool
    // successes whose handlers may not emit side effects on all paths.
    for (const e of executionEvents) {
      if (e.result.error) continue;
      if ((e.toolName === ToolName.CREATE_FILE || e.toolName === ToolName.EDIT_FILE || e.toolName === ToolName.APPEND_FILE || e.toolName === ToolName.COPY_FILE)
          && typeof e.args?.path === 'string' && !writes.includes(e.args.path)) {
        writes.push(e.args.path);
      }
      if (e.toolName === ToolName.COPY_FILE && typeof e.args?.dest === 'string' && !writes.includes(e.args.dest)) {
        writes.push(e.args.dest);
      }
    }

    // Successful calls only (action stop-hook evidence): a gate-rejected or
    // failed call carries `result.error`, so "advertised but blocked" never
    // counts as performed.
    const actions = executionEvents.filter((e) => !e.result.error).map((e) => e.toolName);

    return {
      conversations: { [CONV_KEYS.SESSION_MAIN]: updatedHistory },
      toolCalls: [...state.toolCalls, ...toolCallRecords],
      pendingToolCalls: [],
      _turnToolWrites: [...(state._turnToolWrites ?? []), ...writes],
      _turnToolActions: [...(state._turnToolActions ?? []), ...actions],
      recursionCount: (state.recursionCount ?? 0) + 1,
    };
  },
};

const innerToolNode = createToolNode<UniversalGraphState>(universalToolNodeConfig);

/**
 * Wrapper: exactly one pending call ∧ named clarify ∧ allowed now → the
 * pause node (end-and-resume). Everything else — mixed rounds, unavailable
 * clarify, two clarify calls, invalid args — falls to the inner factory
 * node, whose gateCall answers with the instructive rejection while other
 * calls in the round execute normally.
 */
async function toolNodeFn(state: UniversalGraphState): Promise<Partial<UniversalGraphState>> {
  const pending = state.pendingToolCalls ?? [];
  if (pending.length === 1 && pending[0].name === CLARIFY_TOOL_NAME && isClarifyAllowedNow(state)) {
    const paused = await clarifyPauseNode(state, pending[0]);
    if (paused) return paused;
  }
  // Approval pause (unattended runs, sole-call rounds, no grant) — the tool
  // approval HITL rail. Everything else falls to the inner gate rejection.
  if (
    pending.length === 1 &&
    state._unattended === true &&
    state._approvalGrantTool !== pending[0].name &&
    callNeedsApprovalOnly(state, pending[0])
  ) {
    return approvalPauseNode(state, pending[0]);
  }
  return innerToolNode(state);
}

/** Pure predicate: a clarify/approval pause ends the turn; otherwise loop to agent. */
export function routeAfterTool(state: UniversalGraphState): 'agent' | 'respond' {
  return state._clarifyPause || state._approvalPause ? 'respond' : 'agent';
}

export { toolNodeFn as toolNode };
