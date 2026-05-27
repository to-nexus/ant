/**
 * Detect — job-blind RAC + Progressibility inference.
 *
 * Phase C SSOT for the infer path. Replaces the per-job
 * `code/design/plan` detect strategies that each spun up their own LLM
 * call. The unified flow is:
 *
 *   1. Resolve matrix slot defs for `(intentId, domain)` via
 *      `getConfigSlotsForDomain`. Slot directories form the LLM's
 *      "where to look" hint AND the seed of the tool-call whitelist.
 *   2. Build the whitelist (slot dirs ∪ featureContext.breadcrumbs
 *      anchors ∪ `codebase/`).
 *   3. Render the shared detect prompt (Handlebars template
 *      `jobs/shared/nodes/detect/variants/default/base`).
 *   4. Hand the prompt to the tool-loop runner (reusing
 *      `callLLMWithToolLoop` so we share its cache-friendly framing-
 *      once pattern and the prompt-cache adapter).
 *   5. Parse the final response for `<slots>` / `<missingPrereq>`.
 *   6. `missingPrereq` → `suggestAlternativeIntents` →
 *      `redirect-suggested` (with alternatives) or `blocked` (none).
 *   7. Otherwise → `resolveToRAC` + `loadResolvedArtifacts` →
 *      `status='proceed'`.
 *
 * Empty / unparseable response → 1 retry. Second failure throws so
 * LangGraph's recursionLimit catches the runaway loop.
 *
 * R&R invariants preserved:
 *   - Detect never re-classifies intent (the LLM is *given* `intentId`).
 *   - Detect never decides `executionTier` (that's a job-specific augment).
 *   - All RAC building goes through `resolveToRAC` → `loadResolvedArtifacts`.
 */

import type { LLMClient, ToolDefinition, MessageContentBlock } from '../../../../../core/ports/llm';
import type { PromptBuilder } from '../../../../../core/prompt/builder/PromptBuilder';
import type { FeatureContext } from '../../../../../core/context/featureContextBuilder';
import type { WorkspaceState } from '../triage/types.js';
import type { DetectResult, MissingPrerequisites, SuggestedAlternative } from './types.js';
import type { Domain, IntentId } from '@ant/shared';
import { resolveToRAC, getConfigSlotsForDomain } from '@ant/shared';
import { ARCHITECT_TOOLS } from '../../../tool/toolSchemas';
import { buildDetectWhitelist, isWithinDetectWhitelist } from './detectWhitelist.js';
import { parseDetectResponse, isEmptyDetectResponse } from './parseDetectResponse.js';
import { suggestAlternativeIntents } from './suggestAlternatives.js';
import { loadResolvedArtifacts } from '../../loadDocumentsForRAC.js';
import { LLM_TEMPERATURE, LLM_MAX_TOKENS } from '../../llmConfig';

export interface InferRacWithToolsInput {
  intentId: IntentId;
  domain?: Domain;
  workspaceState?: WorkspaceState;
  featureContext?: FeatureContext;
  featurePath?: string;
  fileSystem: any;
  command?: any;
  llm: LLMClient;
  promptBuilder: PromptBuilder;
  /** Optional locale hint forwarded to the choice card builder. */
  locale?: string;
}

/**
 * Run the job-blind detect tool-use loop. Returns a `DetectResult` whose
 * `status` field is the SSOT for downstream routing.
 *
 * Throws when the LLM produces unparseable output twice in a row — the
 * outer `createDetectNode` factory catches the throw and surfaces a
 * runtime error to the chat UI.
 */
export async function inferRacWithTools(
  input: InferRacWithToolsInput,
): Promise<DetectResult> {
  const { intentId, llm, promptBuilder, featurePath } = input;

  // ── 1. Resolve matrix slot defs ──
  const hasCodebase = input.workspaceState?.hasCodebase ?? false;
  const slots = getConfigSlotsForDomain(intentId, input.domain ?? 'service', { hasCodebase });
  if (!slots) {
    throw new Error(`[detect:inferRacWithTools] No matrix entry for intentId="${intentId}"`);
  }

  const slotDirs = [
    ...slots.refs.map(s => s.path).filter(Boolean),
    ...slots.context.map(s => s.path).filter(Boolean),
  ];
  // target.dir is only present for the 'generate' kind; revise / chat-only /
  // codebase have no static target directory to seed the whitelist.
  if (slots.target.kind === 'generate' && slots.target.dir) {
    slotDirs.push(slots.target.dir);
  }

  // ── 2. Build whitelist (slot dirs ∪ featureContext anchors ∪ codebase/) ──
  const whitelist = buildDetectWhitelist(slotDirs, input.featureContext);

  // ── 3. Render prompt (shared template) ──
  // PromptBuilder.render auto-enriches Codebase Channel vars; the
  // Feature Context Universal Channel only fires through PromptBuilder.build,
  // so we pass featureContext explicitly here to keep the SSOT.
  const slotSummaries = renderSlotSummaries(slots);
  const vars = {
    intentId,
    domain: input.domain ?? 'service',
    slotSummaries,
    whitelistPaths: whitelist.paths,
    workspaceState: input.workspaceState,
    featureContext: input.featureContext,
    // Mirror of the BE bypass below — keeps the LLM from hunting for a
    // missing-prereq surface it cannot block on. The matrix is SSOT;
    // default to required (true) when the slot config omits the flag.
    chatRequiresRefs: slots.chatRequiresRefs ?? true,
  };
  const systemPrompt = await promptBuilder.render(
    'jobs/shared/nodes/detect/variants/default/rules',
    vars,
  );
  const userPrompt = await promptBuilder.render(
    'jobs/shared/nodes/detect/variants/default/base',
    vars,
  );

  // ── 4. Tool-loop run ──
  const tools: ToolDefinition[] = [ARCHITECT_TOOLS.read_file, ARCHITECT_TOOLS.list_files];

  const silentChatStatus: any = new Proxy({}, { get: () => async () => undefined });
  const toolCtx: any = {
    fileSystem: input.fileSystem,
    chatStatus: silentChatStatus,
    workingDir: featurePath || process.cwd(),
    featurePath,
    command: input.command,
  };

  const toolHandler = async (name: string, args: Record<string, any>) => {
    const target = (args.path ?? args.directory ?? '') as string;
    const gate = isWithinDetectWhitelist(target, whitelist);
    if (!gate.ok) return `Error: ${gate.reason}`;

    const { handleReadFile, handleListFiles } = await import('../../../tool/handlers');
    let res;
    if (name === 'read_file') {
      res = await handleReadFile(toolCtx, args as { path: string; startLine?: number; endLine?: number });
    } else if (name === 'list_files') {
      res = await handleListFiles(toolCtx, args as { directory?: string; pattern?: string });
    } else {
      return `Error: Unknown tool "${name}"`;
    }
    return typeof res.content === 'string' ? res.content : JSON.stringify(res.content);
  };

  const { callLLMWithToolLoop } = await import('../../../llm/callLLMWithToolLoop');

  const messages: Array<{ role: string; content: string | MessageContentBlock[] }> = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  let parsedResp = await runOnce(llm, messages, tools, toolHandler);
  if (isEmptyDetectResponse(parsedResp)) {
    console.warn('[detect:inferRacWithTools] Empty parse — retrying once');
    parsedResp = await runOnce(llm, messages, tools, toolHandler);
    if (isEmptyDetectResponse(parsedResp)) {
      throw new Error('[detect:inferRacWithTools] LLM produced no parseable <slots> or <missingPrereq>');
    }
  }

  // SSOT: directive-capable intents (matrix `chatRequiresRefs: false`)
  // cannot be blocked on missing refs when invoked via infer — the user's
  // directive itself is the input. `inferRacWithTools` only runs on the
  // infer path (explicit takes a separate branch in `createInferDetectNode`
  // that builds RAC directly), so we do not need an explicit/infer source
  // check here. The matrix is authoritative — never hard-code intent ids.
  if (parsedResp.missingPrereq && slots.chatRequiresRefs === false) {
    console.log(
      `[detect:inferRacWithTools] LLM emitted <missingPrereq> for ${intentId} ` +
        `but slots.chatRequiresRefs === false — bypassing block, proceeding directive-only`,
    );
    parsedResp.missingPrereq = undefined;
  }

  // ── 5. missingPrereq → blocked / redirect-suggested ──
  if (parsedResp.missingPrereq) {
    return buildMissingPrereqResult(
      intentId,
      parsedResp.missingPrereq,
      input.workspaceState,
    );
  }

  // ── 6. proceed → RAC + load artifacts ──
  const resolvedAction = resolveToRAC(
    intentId,
    {
      target: parsedResp.target,
      refs: parsedResp.refs,
      context: parsedResp.context,
      domain: input.domain,
    },
    'infer',
    undefined,
  );

  let artifacts: ReturnType<typeof loadResolvedArtifacts> = [];
  if (featurePath) {
    artifacts = loadResolvedArtifacts(resolvedAction, featurePath);
  }

  return {
    status: 'proceed',
    resolvedAction,
    artifacts,
  };

  // ── helpers ──

  async function runOnce(
    llmClient: LLMClient,
    initialMessages: Array<{ role: string; content: string | MessageContentBlock[] }>,
    toolDefs: ToolDefinition[],
    handler: typeof toolHandler,
  ) {
    const { response } = await callLLMWithToolLoop(
      llmClient,
      initialMessages,
      toolDefs,
      handler,
      {
        temperature: LLM_TEMPERATURE.DETECT,
        maxTokens: LLM_MAX_TOKENS.DEFAULT,
        enableThinking: false,
        maxRounds: 8,
      },
    );
    return parseDetectResponse(response);
  }
}

function buildMissingPrereqResult(
  intentId: IntentId,
  missing: MissingPrerequisites,
  workspaceState: WorkspaceState | undefined,
): DetectResult {
  const suggestedAlternatives = suggestAlternativeIntents(intentId, workspaceState);
  const status: DetectResult['status'] =
    suggestedAlternatives.length > 0 ? 'redirect-suggested' : 'blocked';

  return {
    status,
    missingPrerequisites: missing,
    suggestedAlternatives,
    displayMessage: formatBlockedMessage(intentId, missing, suggestedAlternatives),
    choiceOptions:
      status === 'redirect-suggested' && suggestedAlternatives.length > 0
        ? buildChoiceFromAlternatives(suggestedAlternatives)
        : undefined,
  };
}

function formatBlockedMessage(
  intentId: IntentId,
  missing: MissingPrerequisites,
  alternatives: SuggestedAlternative[],
): string {
  const required = missing.required.length > 0 ? missing.required.join(', ') : 'required input';
  const head = `❌ \`${intentId}\` is blocked — missing prerequisites: ${required}.`;
  if (alternatives.length === 0) return head;
  const list = alternatives.map(a => `  • \`${a.intentId}\` — ${a.reason}`).join('\n');
  return `${head}\n\nSuggested alternatives:\n${list}`;
}

function buildChoiceFromAlternatives(
  alternatives: SuggestedAlternative[],
): import('../triage/types.js').ChoiceOptions {
  const first = alternatives[0];
  return {
    positive: {
      label: first.reason,
      action: 'redirect',
    },
    negative: {
      label: 'Dismiss',
      action: 'dismiss',
    },
  };
}

interface SlotSummary {
  role: 'target' | 'refs' | 'context';
  path: string;
  label: string;
  required: boolean;
  kind?: string;
}

function renderSlotSummaries(slots: ReturnType<typeof getConfigSlotsForDomain> extends infer R
  ? R extends null
    ? never
    : R
  : never): SlotSummary[] {
  if (!slots) return [];
  const out: SlotSummary[] = [];
  // target — `kind: 'generate'` exposes `dir`; revise / chat-only do not.
  if (slots.target.kind === 'generate') {
    out.push({
      role: 'target',
      path: slots.target.dir,
      label: 'Generate target directory',
      required: true,
      kind: 'generate',
    });
  } else if (slots.target.kind === 'revise') {
    out.push({
      role: 'target',
      path: '(picked from refs)',
      label: 'Revise — target == selected ref',
      required: true,
      kind: 'revise',
    });
  } else if (slots.target.kind === 'codebase') {
    out.push({
      role: 'target',
      path: 'codebase/',
      label: 'Codebase output',
      required: true,
      kind: 'codebase',
    });
  } else if (slots.target.kind === 'chat-only') {
    out.push({
      role: 'target',
      path: '(chat only)',
      label: 'Chat-only response (no file output)',
      required: false,
      kind: 'chat-only',
    });
  }
  for (const s of slots.refs) {
    out.push({
      role: 'refs',
      path: s.path,
      label: s.label.en,
      required: s.required,
      kind: s.type,
    });
  }
  for (const s of slots.context) {
    out.push({
      role: 'context',
      path: s.path,
      label: s.label.en,
      required: s.required,
      kind: s.type,
    });
  }
  return out;
}
