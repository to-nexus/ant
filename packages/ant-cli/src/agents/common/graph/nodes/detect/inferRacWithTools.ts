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
import { TEMPLATE_PATHS } from '../../../../../core/prompt/builder/templatePaths';
import type { FeatureContext } from '../../../../../core/context/featureContextBuilder';
import { projectLens } from '../../../../../core/context/lensProjection';
import { contextProfileFor } from '../../../../../core/executionTier/contextProfile';
import type { WorkspaceState } from '../triage/types.js';
import type { DetectResult, MissingPrerequisites, SuggestedAlternative } from './types.js';
import * as fs from 'fs';
import * as path from 'path';
import type { Basis, Domain, IntentId, UiSource } from '@ant/shared';
import {
  resolveToRAC,
  getConfigSlotsForDomain,
  getDefaultTargetPaths,
  deriveChatNeedsRefs,
  pickUiSourceSubgroupDir,
  isUiTreeParentPath,
  isGameArtTreeParentPath,
  ARTIFACT_PREFIX,
} from '@ant/shared';
import { ARCHITECT_TOOLS } from '../../../tool/toolSchemas';
import { buildDetectWhitelist, isWithinDetectWhitelist } from './detectWhitelist.js';
import { parseDetectResponse, isEmptyDetectResponse } from './parseDetectResponse.js';
import { suggestAlternativeIntents, suggestReviseFallback } from './suggestAlternatives.js';
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
  /**
   * Pre-computed basis seed (workspace-persisted settled tiers + per-domain
   * defaults, assembled by the detect node). Attached to the RAC so
   * decompose treats stored tier decisions as authoritative instead of
   * re-inferring every axis per job.
   */
  seedBasis?: Basis;
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

  // `ui-source` slots declare the PARENT dir `visual/ui` and carry the three
  // hard-exclusive subgroups in `.uiSources`. Resolve each to its single valid
  // subgroup dir (mirroring the FE `pickDefaultUiSourceRefs`) so the parent dir
  // never seeds the whitelist / slot summaries — a parent ref would
  // directory-walk across ant/figma/handoff and produce a mixed pool. Cached
  // per slot object so slotDirs + summaries + post-parse narrowing agree.
  const uiSourceDirCache = new Map<unknown, string | null>();
  const resolveSlotDir = (s: SlotLike): string | null => {
    if (s.type !== 'ui-source') return s.path ?? null;
    if (!uiSourceDirCache.has(s)) {
      uiSourceDirCache.set(s, resolveUiSourceDir(s, featurePath, input.workspaceState));
    }
    return uiSourceDirCache.get(s) ?? null;
  };

  const slotDirs = [
    ...slots.refs.map(resolveSlotDir),
    ...slots.context.map(resolveSlotDir),
  ].filter((d): d is string => !!d);
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
  const slotSummaries = renderSlotSummaries(slots, resolveSlotDir, intentId);
  // Escape hatch offered only for revise-kind intents with a deterministic
  // gen-* sibling to fall back to (sharp-choking-glove RCA). Infer-only by
  // construction: this function never runs on the explicit path.
  const reviseFallback = slots.target.kind === 'revise' ? suggestReviseFallback(intentId) : [];
  const allowTargetMismatch = reviseFallback.length > 0;
  // Matrix SSOT for directive-capability — see the vars comment below.
  const chatNeedsRefs = deriveChatNeedsRefs(slots);
  // Context Lens P2 — lean: digests band only (user turns render via the
  // template's own PRIOR USER TURNS block; assistant prose stripped).
  const leanLens = projectLens(input.featureContext, contextProfileFor('detect'));

  const vars = {
    intentId,
    domain: input.domain ?? 'service',
    slotSummaries,
    whitelistPaths: whitelist.paths,
    workspaceState: input.workspaceState,
    featureContext: input.featureContext,
    lens:
      leanLens && (leanLens.digests.length || leanLens.constraintLedger?.length)
        ? { exchanges: [], digests: leanLens.digests, constraintLedger: leanLens.constraintLedger }
        : undefined,
    // Mirror of the BE bypass below — keeps the LLM from hunting for a
    // missing-prereq surface it cannot block on. `deriveChatNeedsRefs` is the
    // matrix SSOT (explicit flag overrides, else real-ref-slot presence): the
    // legacy raw read (`slots.chatRequiresRefs ?? true`) mislabeled implicit
    // directive-capable intents (e.g. gen-code-directive, refs=[emptyRef()])
    // as refs-required, steering the LLM into exhaustive ref-hunting
    // exploration (lapis-oaring-drain RCA).
    chatRequiresRefs: chatNeedsRefs,
    allowTargetMismatch,
  };
  const systemPrompt = await promptBuilder.render(
    TEMPLATE_PATHS.detect.rules!,
    vars,
  );
  const userPrompt = await promptBuilder.render(
    TEMPLATE_PATHS.detect.base,
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

  // Directive-capable intents may legitimately answer with a bare
  // `<slots></slots>` (the prompt says so) — the tag itself is the signal,
  // so only a tag-less response counts as unusable for them.
  const isUnusable = (p: ReturnType<typeof parseDetectResponse>) =>
    isEmptyDetectResponse(p) && (chatNeedsRefs || !p.slotsTagPresent);

  let attempt = await runOnce(llm, messages, tools, toolHandler, { maxRounds: 8 });
  if (isUnusable(attempt.parsed)) {
    console.warn(
      `[detect:inferRacWithTools] Empty parse (stopReason=${attempt.stopReason ?? 'unknown'}, ` +
        `exhausted=${attempt.exhausted}) — retrying with corrective framing`,
    );
    // Corrective retry — a verbatim replay at low temperature reproduces the
    // same failure deterministically (lapis-oaring-drain RCA). Tell the model
    // WHY the previous attempt failed and shrink the round budget so the
    // forced final round arrives before exploration can degenerate again.
    // Original `messages` stays untouched (string contents, fresh array).
    const retryMessages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt + RETRY_CORRECTIVE_NOTE },
    ];
    attempt = await runOnce(llm, retryMessages, tools, toolHandler, { maxRounds: 4 });
    if (isUnusable(attempt.parsed)) {
      // Structural fallback — same philosophy as the chatRequiresRefs
      // missingPrereq bypass below: for directive-capable intents the
      // directive itself is the input, so a slot-inference failure must not
      // kill the job. Proceed with matrix-default (empty) slots and let the
      // downstream pipeline run directive-only.
      if (!chatNeedsRefs) {
        console.warn(
          `[detect:inferRacWithTools] Slot inference failed twice for directive-capable ` +
            `intent ${intentId} — proceeding with matrix-default slots (directive-only)`,
        );
        return {
          status: 'proceed',
          resolvedAction: resolveToRAC(intentId, { domain: input.domain }, 'infer', input.seedBasis),
          artifacts: [],
        };
      }
      throw new Error('[detect:inferRacWithTools] LLM produced no parseable <slots> or <missingPrereq>');
    }
  }
  const parsedResp = attempt.parsed;

  // SSOT: directive-capable intents (matrix `chatRequiresRefs: false`)
  // cannot be blocked on missing refs when invoked via infer — the user's
  // directive itself is the input. `inferRacWithTools` only runs on the
  // infer path (explicit takes a separate branch in `createInferDetectNode`
  // that builds RAC directly), so we do not need an explicit/infer source
  // check here. The matrix is authoritative — never hard-code intent ids.
  if (parsedResp.missingPrereq && !chatNeedsRefs) {
    console.log(
      `[detect:inferRacWithTools] LLM emitted <missingPrereq> for ${intentId} ` +
        `but the intent is directive-capable (deriveChatNeedsRefs=false) — ` +
        `bypassing block, proceeding directive-only`,
    );
    parsedResp.missingPrereq = undefined;
  }

  // Ungated <targetMismatch> (LLM invented it for a non-revise intent or one
  // with no gen-* sibling) → log + ignore, mirroring the chatRequiresRefs
  // bypass above.
  if (parsedResp.targetMismatch && !allowTargetMismatch) {
    console.log(
      `[detect:inferRacWithTools] LLM emitted <targetMismatch> for ${intentId} ` +
        `but the hatch is not offered for this intent — ignoring`,
    );
    parsedResp.targetMismatch = undefined;
  }

  // ── 5a. targetMismatch → user-mediated redirect (never a re-classification:
  // the intentId stays final; the USER picks the gen-* sibling on the card) ──
  if (parsedResp.targetMismatch) {
    return buildTargetMismatchResult(intentId, parsedResp.targetMismatch, reviseFallback, input.workspaceState);
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
  // Deterministic guarantee: even if the LLM echoes the un-narrowed parent
  // `visual/ui` (the slot summary path it was originally shown), rewrite it to
  // the single valid subgroup dir before the RAC is built. `normalizeUiSourceRefs`
  // inside resolveToRAC cannot do this — a parent path classifies as null and
  // slips through, then directory-walks across all subgroups (mixed-pool throw).
  const uiSourceDir =
    [...slots.refs, ...slots.context]
      .filter(s => s.type === 'ui-source')
      .map(resolveSlotDir)
      .find(d => d != null) ?? null;

  const resolvedAction = resolveToRAC(
    intentId,
    {
      target: parsedResp.target,
      refs: narrowSourceTreeParents(parsedResp.refs, uiSourceDir),
      context: narrowSourceTreeParents(parsedResp.context, uiSourceDir),
      domain: input.domain,
    },
    'infer',
    input.seedBasis,
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
    opts: { maxRounds: number },
  ) {
    // DETECT_TOOL_LOOP, not DEFAULT: every detect round is small by shape
    // (tool calls or a few-hundred-token <slots> block). See llmConfig —
    // the 64K DEFAULT let a degenerate GLM final round run ~8 minutes
    // (lapis-oaring-drain RCA).
    const { response, stopReason, exhausted } = await callLLMWithToolLoop(
      llmClient,
      initialMessages,
      toolDefs,
      handler,
      {
        temperature: LLM_TEMPERATURE.DETECT,
        maxTokens: LLM_MAX_TOKENS.DETECT_TOOL_LOOP,
        enableThinking: false,
        maxRounds: opts.maxRounds,
      },
    );
    return { parsed: parseDetectResponse(response), stopReason, exhausted };
  }
}

/**
 * Appended to the retry user prompt after a first empty parse. States the
 * observed failure (budget burned on exploration, no output tag) and the
 * constraint that fixes it — emit early, observe minimally.
 */
const RETRY_CORRECTIVE_NOTE =
  '\n\n[SYSTEM] Your previous attempt failed: it spent the entire observation ' +
  'budget exploring and never emitted an output tag. Observation is a means, ' +
  'not the deliverable. Make at most a few confirming observations, then ' +
  'immediately emit exactly one top-level output tag from the OUTPUT section.';

function buildTargetMismatchResult(
  intentId: IntentId,
  mismatch: { reason?: string },
  alternatives: SuggestedAlternative[],
  workspaceState: WorkspaceState | undefined,
): DetectResult {
  const docNames =
    workspaceState?.specDocNames?.join(', ') ||
    workspaceState?.systemDesignFileNames?.join(', ') ||
    'the existing document';
  const reason = mismatch.reason?.trim();
  const head =
    `⚠️ \`${intentId}\` targets ${docNames}, but its content appears unrelated to this request` +
    (reason ? ` — ${reason}` : '') +
    '.';
  const list = alternatives.map(a => `  • \`${a.intentId}\` — ${a.reason}`).join('\n');
  return {
    status: 'redirect-suggested',
    suggestedAlternatives: alternatives,
    displayMessage: `${head}\n\nWrite a new document instead?\n${list}`,
    choiceOptions: buildChoiceFromAlternatives(alternatives),
  };
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

type ConfigSlots = NonNullable<ReturnType<typeof getConfigSlotsForDomain>>;
type SlotLike = ConfigSlots['refs'][number];

export function renderSlotSummaries(
  slots: ConfigSlots,
  resolveDir: (s: SlotLike) => string | null,
  intentId: IntentId,
): SlotSummary[] {
  if (!slots) return [];
  const out: SlotSummary[] = [];
  // target — `kind: 'generate'` exposes `dir`. Present the RESOLVED canonical
  // path(s) from the matrix SSOT (`getDefaultTargetPaths`) rather than the raw
  // `dir`, but only when they are concrete files (extension present, no `*`
  // glob). Otherwise the LLM echoes a directory as the target and the planner
  // renders `<file path="plan">` → prose, nothing saved (grey-leaving-nurse).
  // Patterns (gen-sys `*-*.md`, gen-spec `*.md`) and outputs-less dirs (visual
  // gen) legitimately have no single file, so fall back to the dir.
  if (slots.target.kind === 'generate') {
    const resolved = getDefaultTargetPaths(intentId) ?? [];
    const concreteFiles = resolved.filter(
      p => !p.includes('*') && /\.[a-z0-9]+$/i.test(p.split('/').pop() || ''),
    );
    const useFiles = concreteFiles.length > 0 && concreteFiles.length === resolved.length;
    out.push({
      role: 'target',
      path: useFiles ? concreteFiles.join(', ') : slots.target.dir,
      label: useFiles ? 'Generate target file(s)' : 'Generate target directory',
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
    const dir = resolveDir(s);
    // ui-source slot with no valid subgroup → drop (don't surface the parent dir).
    if (s.type === 'ui-source' && !dir) continue;
    out.push({
      role: 'refs',
      path: dir ?? s.path,
      label: s.label.en,
      required: s.required,
      kind: s.type,
    });
  }
  for (const s of slots.context) {
    const dir = resolveDir(s);
    if (s.type === 'ui-source' && !dir) continue;
    out.push({
      role: 'context',
      path: dir ?? s.path,
      label: s.label.en,
      required: s.required,
      kind: s.type,
    });
  }
  return out;
}

/**
 * Resolve a `type: 'ui-source'` slot to its single valid subgroup directory
 * (ant > figma > handoff, gated by on-disk validity), or `null` when no
 * subgroup holds valid files. Handles BOTH surfaces (WS2 §3) — the subgroup's
 * own `dir` prefix discriminates UI vs game-art, so this stays single-owner:
 *   - ant     → `hasVisualUi` (UI dirs) / `hasVisualGameArt` (game-art dirs)
 *   - figma   → `hasFigmaConfig` (UI only — game-art figma is a Phase 5+ hook)
 *   - handoff → the subgroup dir holds at least one file (dir-driven, both surfaces)
 */
function resolveUiSourceDir(
  slot: SlotLike,
  featurePath: string | undefined,
  workspaceState: WorkspaceState | undefined,
): string | null {
  const subs = slot.uiSources;
  if (!subs?.length) return null;
  const isGameArt = (dir: string) => dir.startsWith('visual/game-art');
  const triples = subs.map((s: { id: UiSource; dir: string }) => ({
    id: s.id,
    dir: s.dir,
    hasValidFiles:
      s.id === 'ant'
        ? (isGameArt(s.dir) ? !!workspaceState?.hasVisualGameArt : !!workspaceState?.hasVisualUi)
        : s.id === 'figma'
          ? (isGameArt(s.dir) ? false : !!workspaceState?.hasFigmaConfig)
          : s.id === 'handoff'
            ? (!!featurePath && dirHasAnyFile(path.join(featurePath, s.dir)))
            : false,
  }));
  return pickUiSourceSubgroupDir(triples);
}

/** Recursively test whether a directory contains at least one file. */
function dirHasAnyFile(dirAbs: string): boolean {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const e of entries) {
    if (e.isFile()) return true;
    if (e.isDirectory() && dirHasAnyFile(path.join(dirAbs, e.name))) return true;
  }
  return false;
}

/**
 * Rewrite any un-narrowed source-tree parent path (`visual/ui` or
 * `visual/game-art`, WS2 §3) in a ref/context list to the single valid subgroup
 * dir; drop it when there is no valid subgroup. Classified paths
 * (`visual/ui/handoff/...`, `visual/game-art/ant/...`) and unrelated paths pass
 * through unchanged. Output is deduped to keep the RAC list clean. A workspace
 * is single-domain, so at most one parent kind appears and `sourceDir` is that
 * domain's resolved subgroup dir.
 */
function narrowSourceTreeParents(
  paths: string[] | undefined,
  sourceDir: string | null,
): string[] | undefined {
  if (!paths?.length) return paths;
  const out: string[] = [];
  for (const p of paths) {
    const isParent = isUiTreeParentPath(p) || isGameArtTreeParentPath(p);
    const next = isParent ? sourceDir : p;
    if (next && !out.includes(next)) out.push(next);
  }
  return out;
}
