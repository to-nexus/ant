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

import { UNIVERSAL_FEATURE } from '@ant/shared';
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
import { requiresApproval, isMcpToolName, planTurnViolation } from '../../../../core/customAgents/universalToolPolicy';
import { getUniversalMcp, getUniversalRegistry } from '../runtime';

const WRITE_SIDE_EFFECTS = new Set(['fileCreated', 'fileModified']);

/** Execution tools a @plan turn rejects outright (the write gate can't see their targets). */
const PLAN_TURN_EXECUTION_TOOLS = new Set<string>(['run_command', 'http_request']);

const PLAN_TURN_EXECUTION_ERROR = (name: string): string =>
  `"${name}" is blocked: this is a PLAN turn — no work is executed this turn. ` +
  `Write the plan document under plan/ or present the plan in chat; the actual work runs on a normal turn.`;

const universalResultManager = new ToolResultManager(new TokenBudgetManager());

// Exported for the tool-policy reconciliation test (preset ↔ runtime wiring).
export const universalToolNodeConfig: import('../../../common/tool/createToolNode').ToolNodeConfig<UniversalGraphState> = {
  getPendingCalls(state) {
    return (state.pendingToolCalls || []).map((tc) => ({ id: tc.id, name: tc.name, args: tc.args }));
  },

  gateCall(state, call) {
    const resolved = requireActiveCustomJob();

    if (isMcpToolName(call.name)) {
      const info = getUniversalMcp()?.getToolInfo(call.name);
      if (!info) {
        return { allowed: false, error: `Unknown MCP tool "${call.name}" — it is not provided by any connected server.` };
      }
      if (state.turnContext?.planTurn && info.readOnlyHint !== true) {
        return { allowed: false, error: PLAN_TURN_EXECUTION_ERROR(call.name) };
      }
      if (requiresApproval(call.name, resolved.approval, { mcpReadOnlyHint: info.readOnlyHint })) {
        return {
          allowed: false,
          error:
            `"${call.name}" requires user approval and the interactive approval flow is not available yet (fail-closed). ` +
            `Do NOT retry this call. Tell the user what you intended to do and ask them to either perform it themselves ` +
            `or have the job author declare \`tools.approval["${call.name}"]: never\` in job.yaml if it is safe to run unattended.`,
        };
      }
      return { allowed: true };
    }

    if (!resolved.builtinTools.includes(call.name)) {
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
      return {
        allowed: false,
        error:
          `"${call.name}" requires user approval and the interactive approval flow is not available yet (fail-closed). ` +
          `Do NOT retry this call. Tell the user what you intended to do so they can act on it, ` +
          `or the job author can declare \`tools.approval["${call.name}"]: never\` in job.yaml if it is safe to run unattended.`,
      };
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
      // File handlers gate fileTreeUpdate.notifyFileTreeUpdate on
      // project ∧ featureFolder — universal's container rides the constant
      // pseudo-feature, so artifact writes refresh the FE tree live.
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
    // side effects, consumed by respond's outputs-contract check + manifest.
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

    return {
      conversations: { [CONV_KEYS.SESSION_MAIN]: updatedHistory },
      toolCalls: [...state.toolCalls, ...toolCallRecords],
      pendingToolCalls: [],
      _turnToolWrites: [...(state._turnToolWrites ?? []), ...writes],
      recursionCount: (state.recursionCount ?? 0) + 1,
    };
  },
};

const toolNodeFn = createToolNode<UniversalGraphState>(universalToolNodeConfig);

export { toolNodeFn as toolNode };
