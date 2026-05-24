/**
 * Design Detect Strategy
 *
 * LLM-based detection of intentGroup, mode, environment, domain.
 * Returns InferredAction (intentId + slots) consumed by the unified detect node.
 * Handles clarify pause, error exit, and Figma MCP check.
 */

import type { DetectStrategy, DetectResult } from '../../../../../common/graph/nodes/detect/types.js';
import type { DesignGraphState } from '../../state.js';
import type { InferredAction, Mode } from '@ant/shared';
import { isFigmaDataPopulated, ARTIFACT_PREFIX } from '@ant/shared';
import { LLM_TEMPERATURE, LLM_MAX_TOKENS } from '../../../../../common/graph/llmConfig.js';
import { runEstimatingLLMStream } from '../../../../../common/graph/llmHelpers.js';
import { resolveDesignTargetFiles } from '../../../../../../core/types/detection.js';
import { logPrompt } from '../../../../../../core/utils/promptLogger.js';
import * as path from 'path';
import * as fsp from 'fs/promises';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Parsed LLM response shape
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type ParsedDomain = import('@ant/shared').Domain;

interface ParsedDesignResponse {
  intentGroup: 'design-ui' | 'design-system' | 'design-spec' | 'clarify' | 'error';
  intentGroupReasoning: string;
  intentId?: string;
  jobMode: Mode;
  jobModeReasoning: string;
  domain?: ParsedDomain;
  domainReasoning?: string;
  environment?: 'frontend' | 'backend' | 'fullstack';
  environmentReasoning?: string;
  errorMessage?: string;
  errorType?: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Strategy implementation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const designDetectStrategy: DetectStrategy<DesignGraphState> = {
  async run(state): Promise<DetectResult<DesignGraphState>> {
    // ━━━ Detect clarify resume ━━━
    if (state.awaitingDetectClarify && state.overrideDirective) {
      return handleClarifyResume(state);
    }

    const llm = state.deps?.llm;
    const pb = state.deps?.promptBuilder;
    if (!llm || !pb) {
      console.warn('[Design:Detect] Missing llm or promptBuilder dependency.');
      return {
        inferred: {
          intentId: 'gen-sys-full',
          reasoning: { intent: 'promptBuilder or llm not available; defaulting.' },
          sourceJob: 'design',
        },
      };
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔍 DETECT: Design work type + environment');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const directive = state.overrideDirective || state.directive || '';
    const featurePath = state.context.featurePath || '';
    const figmaPopulated = isFigmaDataPopulated(state.figmaConfig);

    // Phase 1 (10.2) — explicit > infer. When `actionMetadata.domain` is
    // set the LLM does NOT need to re-infer it; the prompt template gates
    // the domain instructions on `{{#unless explicitDomain}}` and the
    // strategy short-circuits the parsed domain to `actionMetadata.domain`.
    const explicitDomain = state.actionMetadata?.domain;

    // Scan assets, existing docs
    const { hasAssets, assetsList, uiAssetsList } = await scanInputs(featurePath);

    // Pre-RAC SSOT — `state.workspaceState.systemDesignFileNames` is filled by triage's
    // `analyzeWorkspace`. Reading `state.existingDesignDocs` here would couple
    // detect to design resolve's body cache (post-RAC pool); we only need
    // filenames at this stage. See `AGENTS.md` "state.artifacts Post-RAC SSOT".
    const existingDocNames = state.workspaceState?.systemDesignFileNames ?? [];
    const hasSystemDocs = existingDocNames.length > 0;

    // Build prompt
    const prompt = await pb.render('jobs/design/nodes/detect/variants/default/base', {
      directive,
      hasAssets: hasAssets || false,
      assetsList: assetsList || '',
      figmaPopulated: figmaPopulated || false,
      hasVisualUi: await hasUiDocsOnDisk(featurePath),
      hasUiTokens: await fileExistsInAntDir('ui-tokens.json', featurePath),
      hasUiAssets: await fileExistsInAntDir('ui-assets.json', featurePath),
      hasUiSpec: await fileExistsInAntDir('ui-spec.json', featurePath),
      hasSystemDocs,
      hasSystemDesign: existingDocNames.some(f => f.startsWith('be-system-') || f.startsWith('fe-system-')),
      hasApiContract: existingDocNames.some(f => f.startsWith('api-contract-')),
      hasFeSystemDesign: existingDocNames.some(f => f.startsWith('fe-system-')),
      hasBeSystemDesign: existingDocNames.some(f => f.startsWith('be-system-')),
      systemDesignFiles: existingDocNames || [],
      explicitDomain,
    });

    // Log prompt
    const jobId = state.jobId || state._httpJobId || 'unknown';
    if (featurePath) {
      try {
        await logPrompt(featurePath, jobId, 'design', 'detect', prompt.length, {
          templatePath: 'jobs/design/nodes/detect/variants/default/base',
          injectedVariables: { hasAssets, hasSystemDocs },
        });
      } catch { /* non-critical */ }
    }

    // LLM call
    const { getChatAPIClient } = await import('../../../../../../core/adapters/ChatAPIClient.js');
    const chatAPI = getChatAPIClient();
    await chatAPI.showChatStatus('placeholder');

    const { response } = await runEstimatingLLMStream(
      state,
      'detect',
      () => llm.stream(
        [{ role: 'user', content: prompt }],
        { temperature: LLM_TEMPERATURE.DETECT, maxTokens: LLM_MAX_TOKENS.DEFAULT, enableThinking: false },
      ),
      () => {},
      { subNode: 'design', promptChars: prompt.length },
    );

    const parsed = parseDesignDetectResponse(response);

    // Phase 1 (10.2): explicit > infer — when actionMetadata.domain was
    // supplied, override any LLM-emitted domain (the prompt asked the LLM
    // to suppress it, but defense-in-depth wins over prompt compliance).
    if (explicitDomain) {
      parsed.domain = explicitDomain;
      parsed.domainReasoning = `Explicit actionMetadata.domain=${explicitDomain} — LLM domain inference skipped.`;
    }

    // skipTriage override: explain→generate when redirect context
    if (state.skipTriage && parsed.jobMode === 'explain' && parsed.intentGroup !== 'error' && parsed.intentGroup !== 'clarify') {
      parsed.jobMode = 'generate';
      parsed.jobModeReasoning = 'Overridden from explain: skipTriage flag indicates active work intent.';
    }

    // ━━━ Error exit ━━━
    if (parsed.intentGroup === 'error') {
      console.log(`\n❌ Error: ${parsed.errorType}`);
      const errorText = `❌ **${parsed.errorMessage}**`;
      await chatAPI.sendLLMEvent({ type: 'text', text: errorText });
      await chatAPI.finalizeMessage();
      return {
        skipRACCreation: true,
        stateUpdates: {
          designError: { type: parsed.errorType || 'unknown_error', message: parsed.errorMessage || 'An error occurred' },
        } as Partial<DesignGraphState>,
      };
    }

    // ━━━ Clarify exit ━━━
    if (parsed.intentGroup === 'clarify') {
      console.log(`\n💬 Clarify needed: ${parsed.intentGroupReasoning}`);
      await sendDetectClarifyCard();
      await saveDetectClarifyToSession(state);
      if (state.deps?.kanbanUpdate?.clearEstimatingActivity) {
        state.deps.kanbanUpdate.clearEstimatingActivity();
      }
      return {
        skipRACCreation: true,
        stateUpdates: {
          awaitingDetectClarify: true,
          tokenUsage: state.tokenUsage,
        } as Partial<DesignGraphState>,
      };
    }

    // ━━━ Build InferredAction ━━━
    const inferred = buildInferredAction(parsed, { figmaPopulated });

    // Resolve targetFiles for system-design
    if (parsed.intentGroup === 'design-system') {
      const { targetFiles, effectiveMode } = resolveDesignTargetFiles(
        inferred.intentId,
        parsed.jobMode,
        existingDocNames,
      );
      inferred.target = targetFiles;

      if (effectiveMode !== parsed.jobMode) {
        const correctedIntentId = mapToIntentId(parsed.intentGroup, effectiveMode, { environment: parsed.environment });
        inferred.intentId = correctedIntentId;
        if (inferred.reasoning) {
          inferred.reasoning.intent = (inferred.reasoning.intent || '') +
            ` (corrected: no same-tier docs for ${parsed.environment})`;
        }
      }
    }

    // Resolve refs for design-spec refactor (marble-barking-grass).
    // `rev-spec` carries `target: { kind: 'revise' }` + `refsSingleSelect: true`
    // — the single selected ref IS the target file. The infer pipeline has
    // no LLM-visible spec inventory, so we resolve here from the pre-RAC
    // workspace fact `specDocNames` (populated by triage's workspaceAnalyzer).
    //   0 specs   → error before RAC (no surface to revise)
    //   1 spec    → auto-pick
    //   ≥2 specs  → directive substring match; if not unique → spec-pick clarify
    if (parsed.intentGroup === 'design-spec' && parsed.jobMode === 'refactor') {
      const specPickResult = await resolveSpecPick(state);
      if (specPickResult.kind === 'error') {
        return specPickResult.result;
      }
      if (specPickResult.kind === 'clarify') {
        return specPickResult.result;
      }
      inferred.refs = [`${ARTIFACT_PREFIX.SPEC}${specPickResult.picked}`];
      console.log(`✅ [Design:Detect] rev-spec auto-picked: ${specPickResult.picked}`);
    }

    console.log(`\n✅ Mode: ${parsed.jobMode}`);
    console.log(`✅ IntentId: ${inferred.intentId}`);

    // ━━━ Figma MCP check ━━━
    const stateUpdates: Partial<DesignGraphState> = {};

    if (parsed.intentGroup === 'design-ui' && figmaPopulated) {
      const figmaError = await checkFigmaMCPReachable(state);
      if (figmaError) {
        console.log(`\n❌ Figma MCP unavailable: ${figmaError.message}`);
        const errorText = `❌ **${figmaError.message}**`;
        await chatAPI.sendLLMEvent({ type: 'text', text: errorText });
        await chatAPI.finalizeMessage();
        stateUpdates.designError = figmaError;
        stateUpdates.tokenUsage = state.tokenUsage;
        return { inferred, stateUpdates };
      }
      // figmaFileKey / figmaStartNodeId are seeded by `designResolveStrategy.
      // loadArtifacts` (single SSOT for figmaConfig.file → parsed parts) so
      // both the explicit and infer detect paths converge on the same key.
      // Detect only owns MCP reachability here — URL parseability is a
      // separate, resolve-time concern. See `agents/architect/graph/design/
      // nodes/resolve.ts` for the seeding block.
      console.log(`✅ Figma MCP reachable — pipeline=figma`);
    } else if (parsed.intentGroup === 'design-ui') {
      stateUpdates.uiAssetsList = uiAssetsList;
    }

    // Spec Figma availability (graceful).
    // figmaFileKey / figmaStartNodeId are already seeded by resolve; the
    // re-assignment here is idempotent because `extractFigmaUrlParts` is
    // a pure function over the same `figmaConfig.file`. The genuinely
    // additive value detect contributes is `figmaAvailable` (MCP probe
    // outcome), which resolve cannot determine. If MCP is unreachable
    // `checkSpecFigma` returns `undefined`, so the resolve-seeded keys
    // survive untouched and the worker subgraph keeps the URL reference
    // available for non-MCP code paths.
    if (parsed.intentGroup === 'design-spec' && isFigmaDataPopulated(state.figmaConfig)) {
      const specFigma = await checkSpecFigma(state);
      if (specFigma) {
        stateUpdates.figmaAvailable = specFigma.available;
        stateUpdates.figmaFileKey = specFigma.fileKey;
        stateUpdates.figmaStartNodeId = specFigma.startNodeId;
      }
    }

    stateUpdates.tokenUsage = state.tokenUsage;
    return { inferred, stateUpdates };
  },

  isAwaitingInput(state): boolean {
    return !!(state.awaitingDetectClarify && state.overrideDirective);
  },
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Internal helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function handleClarifyResume(state: DesignGraphState): Promise<DetectResult<DesignGraphState>> {
  console.log(`🔄 [Design:Detect] Clarify resume — parsing user choice`);
  const directive = state.overrideDirective!;

  // Spec-pick clarify resume (marble-barking-grass): if the directive
  // matches one of the workspace's spec basenames, the user is choosing
  // which spec to revise — short-circuit to rev-spec with that ref. Try
  // this BEFORE the spec-vs-system parser so a spec named e.g.
  // `spec-rewrite.md` doesn't get misclassified as "new spec / generate".
  const pickedSpec = matchSpecPick(directive, state.workspaceState?.specDocNames ?? []);
  if (pickedSpec) {
    console.log(`✅ User picked spec to revise: ${pickedSpec}`);
    const inferred: InferredAction = {
      intentId: 'rev-spec',
      refs: [`${ARTIFACT_PREFIX.SPEC}${pickedSpec}`],
      reasoning: {
        intent: `User picked ${pickedSpec} from spec-pick clarify.`,
      },
      sourceJob: 'design',
    };
    return {
      inferred,
      stateUpdates: { awaitingDetectClarify: false } as Partial<DesignGraphState>,
    };
  }

  const hasSystemDocs = (state.workspaceState?.systemDesignFileNames?.length ?? 0) > 0;
  const choice = parseDetectClarifyChoice(directive, hasSystemDocs);
  console.log(`✅ User chose: intentGroup=${choice.intentGroup}, mode=${choice.jobMode}`);

  const intentId = mapToIntentId(choice.intentGroup, choice.jobMode, {
    environment: choice.intentGroup === 'design-system' ? 'fullstack' : undefined,
  });

  // Phase 1: clarify-resume defers domain to the RAC fallback (service)
  // unless `actionMetadata.domain` was set explicitly. The clarify card
  // does not ask about domain — it only disambiguates intentGroup.
  const inferred: InferredAction = {
    intentId,
    reasoning: {
      intent: `User explicitly chose ${choice.intentGroup} (${choice.jobMode}).`,
    },
    sourceJob: 'design',
  };

  return {
    inferred,
    stateUpdates: { awaitingDetectClarify: false } as Partial<DesignGraphState>,
  };
}

/**
 * Spec-pick resolver — used both at fresh detect (auto-pick / clarify
 * emission) and at clarify resume (user choice → ref).
 *
 * Disambiguates a chat-driven `rev-spec` against the workspace's known
 * spec files (`state.workspaceState.specDocNames`). Returns the matched
 * basename if exactly one matches; null otherwise. The match runs a
 * lowercase substring scan with the `.md` suffix trimmed — covers both
 * "review explorer-panel-mismatch" directives and clarify-card click
 * payloads (which echo the basename verbatim).
 */
function matchSpecPick(directive: string, specDocNames: string[]): string | null {
  if (!directive || specDocNames.length === 0) return null;
  const lower = directive.trim().toLowerCase();

  // Exact basename match wins over substring — covers the clarify-resume
  // case where the directive equals the option label verbatim AND avoids
  // ambiguity when one basename is a substring of another (e.g.
  // `explorer.md` vs `explorer-panel.md`).
  const exact = specDocNames.find(name => name.replace(/\.md$/, '').toLowerCase() === lower);
  if (exact) return exact;

  // Substring fallback — fresh-detect directive like "review the
  // explorer-panel-mismatch spec". Returns only when uniquely identifiable.
  const hits = specDocNames.filter(name => {
    const basename = name.replace(/\.md$/, '').toLowerCase();
    return lower.includes(basename);
  });
  return hits.length === 1 ? hits[0] : null;
}

type SpecPickResult =
  | { kind: 'picked'; picked: string }
  | { kind: 'error'; result: DetectResult<DesignGraphState> }
  | { kind: 'clarify'; result: DetectResult<DesignGraphState> };

/**
 * Fresh-detect spec resolver — applies the 0 / 1 / N branches:
 *
 *   - 0 specs → return an error result (no surface to revise).
 *   - 1 spec → auto-pick.
 *   - 2+ specs: try directive substring match; if exactly one hits,
 *     auto-pick. Otherwise emit a spec-pick clarify card and return a
 *     skipRACCreation result so the graph pauses at detect.
 */
async function resolveSpecPick(state: DesignGraphState): Promise<SpecPickResult> {
  const specDocNames = state.workspaceState?.specDocNames ?? [];

  if (specDocNames.length === 0) {
    const { getChatAPIClient } = await import('../../../../../../core/adapters/ChatAPIClient.js');
    const chatAPI = getChatAPIClient();
    const errorText = `❌ **수정할 스펙 문서가 없습니다.** \`architecture/spec/\` 디렉토리에 스펙 문서를 먼저 생성해주세요.`;
    await chatAPI.sendLLMEvent({ type: 'text', text: errorText });
    await chatAPI.finalizeMessage();
    return {
      kind: 'error',
      result: {
        skipRACCreation: true,
        stateUpdates: {
          designError: { type: 'missing_documents', message: 'No spec documents to revise' },
          tokenUsage: state.tokenUsage,
        } as Partial<DesignGraphState>,
      },
    };
  }

  if (specDocNames.length === 1) {
    return { kind: 'picked', picked: specDocNames[0] };
  }

  const directive = state.overrideDirective || state.directive || '';
  const matched = matchSpecPick(directive, specDocNames);
  if (matched) {
    return { kind: 'picked', picked: matched };
  }

  console.log(`\n💬 [Design:Detect] rev-spec ambiguous — ${specDocNames.length} candidate specs, asking user`);
  await sendSpecPickCard(specDocNames);
  await saveDetectClarifyToSession(state);
  if (state.deps?.kanbanUpdate?.clearEstimatingActivity) {
    state.deps.kanbanUpdate.clearEstimatingActivity();
  }
  return {
    kind: 'clarify',
    result: {
      skipRACCreation: true,
      stateUpdates: {
        awaitingDetectClarify: true,
        tokenUsage: state.tokenUsage,
      } as Partial<DesignGraphState>,
    },
  };
}

async function sendSpecPickCard(specDocNames: string[]): Promise<void> {
  const { sendClarify } = await import('../../../../../common/clarify');
  await sendClarify([{
    question: '어떤 스펙 문서를 수정할까요?',
    options: specDocNames.map(name => name.replace(/\.md$/, '')),
  }]);
}

function mapToIntentId(
  intentGroup: 'design-ui' | 'design-system' | 'design-spec',
  mode: Mode,
  options?: { environment?: string; figmaPopulated?: boolean },
): string {
  if (intentGroup === 'design-ui') {
    if (mode === 'refactor') return 'rev-ui';
    if (mode === 'explain') return 'explain-ui';
    if (options?.figmaPopulated) return 'gen-ui-figma';
    return 'gen-ui-desc';
  }
  if (intentGroup === 'design-spec') {
    if (mode === 'refactor') return 'rev-spec';
    if (mode === 'explain') return 'explain-spec';
    return 'gen-spec';
  }
  // design-system
  if (mode === 'refactor') return 'rev-sys';
  if (mode === 'explain') return 'explain-sys';
  if (options?.environment === 'frontend') return 'gen-sys-fe';
  if (options?.environment === 'backend') return 'gen-sys-be';
  return 'gen-sys-full';
}

function buildInferredAction(
  parsed: ParsedDesignResponse,
  options: { figmaPopulated: boolean },
): InferredAction {
  const intentGroup = parsed.intentGroup as 'design-ui' | 'design-system' | 'design-spec';

  const intentId = parsed.intentId || mapToIntentId(intentGroup, parsed.jobMode, {
    environment: parsed.environment,
    figmaPopulated: options.figmaPopulated,
  });

  return {
    intentId,
    domain: parsed.domain,
    reasoning: {
      intent: parsed.jobModeReasoning || parsed.intentGroupReasoning,
      domain: parsed.domainReasoning,
    },
    sourceJob: 'design',
  };
}

function parseDesignDetectResponse(raw: string): ParsedDesignResponse {
  try {
    const detectMatch = raw.match(/<detect>\s*([\s\S]*?)\s*<\/detect>/);
    let jsonStr: string;
    if (detectMatch) {
      jsonStr = detectMatch[1];
    } else {
      const jsonMatch = raw.match(/```json\n([\s\S]*?)\n```/) || raw.match(/{[\s\S]*}/);
      if (!jsonMatch) throw new Error('No JSON found');
      jsonStr = (jsonMatch[1] || jsonMatch[0]).trim();
    }
    const parsed = JSON.parse(jsonStr);

    const rawIG = parsed.intentGroup ?? parsed.workType;
    const intentGroup: ParsedDesignResponse['intentGroup'] =
      (rawIG === 'ui-design' || rawIG === 'design-ui') ? 'design-ui' :
      (rawIG === 'spec' || rawIG === 'design-spec') ? 'design-spec' :
      rawIG === 'clarify' ? 'clarify' :
      rawIG === 'error' ? 'error' : 'design-system';

    if (intentGroup === 'error') {
      return {
        intentGroup: 'error', intentGroupReasoning: parsed.intentGroupReasoning ?? parsed.workTypeReasoning ?? '',
        jobMode: 'generate', jobModeReasoning: '',
        errorMessage: parsed.errorMessage || '문서가 존재하지 않습니다',
        errorType: parsed.errorType || 'missing_documents',
      };
    }
    if (intentGroup === 'clarify') {
      return {
        intentGroup: 'clarify',
        intentGroupReasoning: parsed.intentGroupReasoning ?? parsed.workTypeReasoning ?? 'Ambiguous.',
        jobMode: 'generate', jobModeReasoning: '',
      };
    }

    const jobMode: Mode =
      (parsed.jobMode || parsed.designMode) === 'refactor' ? 'refactor' :
      (parsed.jobMode || parsed.designMode) === 'explain' ? 'explain' : 'generate';
    const jobModeReasoning = parsed.jobModeReasoning || parsed.designModeReasoning
      || (jobMode === 'refactor' ? 'Modification of existing documents requested.'
        : jobMode === 'explain' ? 'Analysis or explanation of existing documents requested.'
        : 'New document creation or full regeneration requested.');

    // Domain is now universal across artifact-producing design intents
    // (design-system / design-ui / design-spec). The strategy emits
    // `<domain>` if signals are present; otherwise undefined leaves the
    // RAC default to `service` via `getEffectiveDomain`. Phase 1 D11.
    const rawDomain = (parsed.domain ?? '').toString().toLowerCase();
    const domain: ParsedDomain | undefined =
      rawDomain === 'game' || rawDomain === 'service' ? rawDomain as ParsedDomain : undefined;
    const domainReasoning = typeof parsed.domainReasoning === 'string' ? parsed.domainReasoning : undefined;

    if (intentGroup === 'design-system') {
      return {
        intentGroup, intentGroupReasoning: parsed.intentGroupReasoning ?? 'System design work detected.',
        intentId: parsed.intentId, jobMode, jobModeReasoning,
        domain,
        domainReasoning,
        environment: parsed.environment === 'frontend' ? 'frontend' : parsed.environment === 'backend' ? 'backend' : 'fullstack',
        environmentReasoning: parsed.environmentReasoning || "Defaulted to 'fullstack'.",
      };
    }

    return {
      intentGroup,
      intentGroupReasoning: parsed.intentGroupReasoning
        ?? (intentGroup === 'design-ui' ? 'UI design work detected.' : 'Spec document work detected.'),
      intentId: parsed.intentId, jobMode, jobModeReasoning,
      domain,
      domainReasoning,
    };
  } catch (error) {
    console.error('❌ [Design:Detect] Failed to parse LLM response:', error);
    console.error('Raw response (truncated):', raw.substring(0, 500));
    return {
      intentGroup: 'clarify',
      intentGroupReasoning: 'Failed to parse LLM response. Asking user to clarify.',
      jobMode: 'generate', jobModeReasoning: '',
    };
  }
}

function parseDetectClarifyChoice(
  directive: string, hasSystemDocs: boolean,
): { intentGroup: 'design-spec' | 'design-system'; jobMode: Mode } {
  const lower = directive.toLowerCase();
  if (lower.includes('spec') || lower.includes('스펙 문서'))
    return { intentGroup: 'design-spec', jobMode: 'generate' };
  if (lower.includes('시스템 기획서 수정') || lower.includes('system-design'))
    return { intentGroup: 'design-system', jobMode: hasSystemDocs ? 'refactor' : 'generate' };
  if (lower.includes('수정') || lower.includes('modify') || lower.includes('refactor'))
    return { intentGroup: 'design-system', jobMode: hasSystemDocs ? 'refactor' : 'generate' };
  return { intentGroup: 'design-spec', jobMode: 'generate' };
}

async function sendDetectClarifyCard(): Promise<void> {
  const { sendClarify } = await import('../../../../../common/clarify');
  await sendClarify([{
    question: '어떤 작업을 수행할까요?',
    options: ['새로운 스펙 문서 생성 (spec-*.md)', '기존 시스템 기획서 수정'],
  }]);
}

async function saveDetectClarifyToSession(state: DesignGraphState): Promise<void> {
  const { saveClarifyCheckpoint } = await import('../../session/checkpoint');
  await saveClarifyCheckpoint(state, { kind: 'detect' });
}

async function checkFigmaMCPReachable(state: DesignGraphState): Promise<DesignGraphState['designError'] | undefined> {
  const { checkLocalMCPAvailability } = await import('../../../../../../periphery/adapters/figma/MCPTransport.js');
  const serverMode = process.env.ANT_SERVER_MODE || 'local';
  if (serverMode === 'local') {
    const ok = await checkLocalMCPAvailability();
    if (!ok) return { type: 'figma_mcp_unavailable', message: 'Figma Desktop이 실행되지 않았습니다.' };
  } else {
    const userId = state.context?.userId;
    const redis = state.deps?.redis;
    if (!userId || !redis) return { type: 'figma_bridge_unavailable', message: !userId ? 'Context missing.' : 'Redis unavailable.' };
    try {
      const { createMCPTransport } = await import('../../../../../../periphery/adapters/figma/MCPTransport.js');
      const transport = createMCPTransport({ serverMode: 'cloud', userId, redis });
      if (!(await transport.isAvailable())) return { type: 'figma_bridge_unavailable', message: 'Ant Desktop 앱이 연결되지 않았거나 Figma Desktop이 응답하지 않습니다.' };
    } catch { return { type: 'figma_bridge_unavailable', message: 'Ant Desktop 확인 실패.' }; }
  }
  return undefined;
}

async function checkSpecFigma(state: DesignGraphState): Promise<{ available: boolean; fileKey?: string; startNodeId?: string } | undefined> {
  const { checkLocalMCPAvailability } = await import('../../../../../../periphery/adapters/figma/MCPTransport.js');
  const serverMode = process.env.ANT_SERVER_MODE || 'local';
  let mcpReachable = false;
  try {
    if (serverMode === 'local') {
      mcpReachable = await checkLocalMCPAvailability();
    } else {
      const userId = state.context?.userId;
      const redis = state.deps?.redis;
      if (userId && redis) {
        const { createMCPTransport } = await import('../../../../../../periphery/adapters/figma/MCPTransport.js');
        const transport = createMCPTransport({ serverMode: 'cloud', userId, redis });
        mcpReachable = await transport.isAvailable();
      }
    }
  } catch { /* non-critical */ }

  if (mcpReachable && state.figmaConfig?.file) {
    const { extractFigmaUrlParts } = await import('@ant/shared');
    const parts = extractFigmaUrlParts(state.figmaConfig.file);
    if (parts.fileKey) {
      console.log(`✅ [Design:Detect] Spec Figma MCP available (fileKey=${parts.fileKey})`);
      return { available: true, fileKey: parts.fileKey, startNodeId: parts.nodeId };
    }
  }
  if (!mcpReachable) console.log(`ℹ️  [Design:Detect] Spec has figma.json but MCP unavailable`);
  return undefined;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// File scanning helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function listFilesRecursive(dirPath: string, relativeTo = ''): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const relPath = relativeTo ? `${relativeTo}/${entry.name}` : entry.name;
      if (entry.isFile()) results.push(relPath);
      else if (entry.isDirectory()) results.push(...await listFilesRecursive(path.join(dirPath, entry.name), relPath));
    }
  } catch { /* directory doesn't exist */ }
  return results;
}

async function scanInputs(featurePath: string) {
  const assetsDir = path.join(featurePath, 'assets');

  const assetFiles = await listFilesRecursive(assetsDir);
  const hasAssets = assetFiles.length > 0;

  let assetsList = '';
  let uiAssetsList: Record<string, string[]> | undefined;
  if (hasAssets) {
    const grouped: Record<string, string[]> = {};
    for (const f of assetFiles) {
      const sep = f.indexOf('/');
      const group = sep > 0 ? f.substring(0, sep) : '(root)';
      (grouped[group] ||= []).push(f);
    }
    uiAssetsList = grouped;
    assetsList = Object.entries(grouped).map(([g, files]) => `**${g}/** (${files.length} files)`).join('\n');
  }

  return { hasAssets, assetsList, uiAssetsList };
}

async function fileExistsInAntDir(filename: string, featurePath: string): Promise<boolean> {
  const antDir = path.join(featurePath, ARTIFACT_PREFIX.UI_ANT.replace(/\/$/, ''));
  try {
    await fsp.access(path.join(antDir, filename));
    return true;
  } catch {
    return false;
  }
}

async function hasUiDocsOnDisk(featurePath: string): Promise<boolean> {
  const tokens = await fileExistsInAntDir('ui-tokens.json', featurePath);
  const assets = await fileExistsInAntDir('ui-assets.json', featurePath);
  const spec = await fileExistsInAntDir('ui-spec.json', featurePath);
  return tokens && assets && spec;
}
