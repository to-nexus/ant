/**
 * Design Detect Strategy
 *
 * LLM-based detection of intentGroup, mode, environment, domain.
 * Returns InferredAction (intentId + slots) consumed by the unified detect node.
 * Handles clarify pause, error exit, and Figma MCP check.
 */

import type { DetectStrategy, DetectResult } from '../../../../../common/graph/nodes/detect/types.js';
import type { DesignGraphState } from '../../state.js';
import type { InferredAction, Mode, DesignDomain } from '@ant/shared';
import { isFigmaDataPopulated, DESIGN_DIR, DESIGN_SUBDIR } from '@ant/shared';
import { LLM_TEMPERATURE, LLM_MAX_TOKENS } from '../../../../../common/graph/llmConfig.js';
import { resolveDesignTargetFiles } from '../../../../../../core/types/detection.js';
import { logPrompt } from '../../../../../../core/utils/promptLogger.js';
import * as path from 'path';
import * as fsp from 'fs/promises';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Parsed LLM response shape
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface ParsedDesignResponse {
  intentGroup: 'design-ui' | 'design-system' | 'design-spec' | 'clarify' | 'error';
  intentGroupReasoning: string;
  intentId?: string;
  jobMode: Mode;
  jobModeReasoning: string;
  domain?: DesignDomain;
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
          domain: 'service',
          reasoning: { intent: 'promptBuilder or llm not available; defaulting.', domain: 'Defaulting to service.' },
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

    // Scan references, assets, existing docs
    const { hasReferences, referencesList, hasAssets, assetsList, uiAssetsList, uiReferences } =
      await scanInputs(featurePath);

    const existingDocNames = state.existingDesignDocs ? Object.keys(state.existingDesignDocs) : [];
    const hasSystemDocs = existingDocNames.length > 0;

    // Build prompt
    const prompt = await pb.render('jobs/design/nodes/detect/variants/default/base', {
      directive,
      hasReferences: hasReferences || false,
      hasAssets: hasAssets || false,
      referencesList: referencesList || '',
      assetsList: assetsList || '',
      figmaPopulated: figmaPopulated || false,
      hasUiDocs: await hasUiDocsOnDisk(featurePath),
      hasUiTokens: await fileExistsInDirs('ui-tokens.json', featurePath),
      hasUiAssets: await fileExistsInDirs('ui-assets.json', featurePath),
      hasUiSpec: await fileExistsInDirs('ui-spec.json', featurePath),
      hasSystemDocs,
      hasSystemDesign: existingDocNames.some(f => f.startsWith('be-system-') || f.startsWith('fe-system-')),
      hasApiContract: existingDocNames.some(f => f.startsWith('api-contract-')),
      hasFeSystemDesign: existingDocNames.some(f => f.startsWith('fe-system-')),
      hasBeSystemDesign: existingDocNames.some(f => f.startsWith('be-system-')),
      systemDesignFiles: existingDocNames || [],
    });

    // Log prompt
    const jobId = state.jobId || state._httpJobId || 'unknown';
    if (featurePath) {
      try {
        await logPrompt(featurePath, jobId, 'design', 'detect', prompt.length, {
          templatePath: 'jobs/design/nodes/detect/variants/default/base',
          injectedVariables: { hasReferences, hasAssets, hasSystemDocs },
        });
      } catch { /* non-critical */ }
    }

    // LLM call
    const { getChatAPIClient } = await import('../../../../../../core/adapters/ChatAPIClient.js');
    const chatAPI = getChatAPIClient();
    await chatAPI.showChatStatus('placeholder');

    let response = '';
    let capturedUsage: any = undefined;
    for await (const event of llm.stream(
      [{ role: 'user', content: prompt }],
      { temperature: LLM_TEMPERATURE.DETECT, maxTokens: LLM_MAX_TOKENS.DEFAULT, enableThinking: false },
    )) {
      if (event.type === 'retry') { response = ''; capturedUsage = undefined; continue; }
      if (event.text) response += event.text;
      const { extractTokenUsageFromStreamEvent } = await import('../../../../../common/graph/llmHelpers.js');
      const usage = extractTokenUsageFromStreamEvent(event);
      if (usage) capturedUsage = usage;
    }

    if (capturedUsage) {
      const { accumulateTokenUsage, logTokenUsageToFile } = await import('../../../../../common/graph/llmHelpers.js');
      accumulateTokenUsage(state, capturedUsage, { taskLevel: false, jobLevel: true });
      if (state.deps?.kanbanUpdate?.updateTokenUsage && state.tokenUsage) {
        state.deps.kanbanUpdate.updateTokenUsage(state.tokenUsage);
      }
      logTokenUsageToFile(state.context?.featurePath, state.jobId || state._httpJobId, capturedUsage, {
        taskId: 'estimating', taskName: 'detect', node: 'detect', callIndex: 0, estimatedPromptChars: prompt.length,
      });
    }

    // Parse
    const parsed = parseDesignDetectResponse(response);

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
    const inferred = buildInferredAction(parsed, { figmaPopulated, hasReferences });

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
      console.log(`✅ Figma MCP reachable — pipeline=figma`);
    } else if (parsed.intentGroup === 'design-ui') {
      stateUpdates.uiReferences = uiReferences;
      stateUpdates.uiAssetsList = uiAssetsList;
    }

    // Spec Figma availability (graceful)
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
  const hasSystemDocs = state.existingDesignDocs ? Object.keys(state.existingDesignDocs).length > 0 : false;
  const choice = parseDetectClarifyChoice(state.overrideDirective!, hasSystemDocs);
  console.log(`✅ User chose: intentGroup=${choice.intentGroup}, mode=${choice.jobMode}`);

  const intentId = mapToIntentId(choice.intentGroup, choice.jobMode, {
    environment: choice.intentGroup === 'design-system' ? 'fullstack' : undefined,
  });

  const inferred: InferredAction = {
    intentId,
    domain: choice.intentGroup === 'design-system' ? 'service' : undefined,
    reasoning: {
      intent: `User explicitly chose ${choice.intentGroup} (${choice.jobMode}).`,
      domain: choice.intentGroup === 'design-system' ? 'Defaulting to service.' : undefined,
    },
    sourceJob: 'design',
  };

  return {
    inferred,
    stateUpdates: { awaitingDetectClarify: false } as Partial<DesignGraphState>,
  };
}

function mapToIntentId(
  intentGroup: 'design-ui' | 'design-system' | 'design-spec',
  mode: Mode,
  options?: { environment?: string; figmaPopulated?: boolean; hasReferences?: boolean },
): string {
  if (intentGroup === 'design-ui') {
    if (mode === 'refactor') return 'rev-ui';
    if (mode === 'explain') return 'explain-ui';
    if (options?.figmaPopulated) return 'gen-ui-figma';
    if (options?.hasReferences) return 'gen-ui-ref';
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
  options: { figmaPopulated: boolean; hasReferences: boolean },
): InferredAction {
  const intentGroup = parsed.intentGroup as 'design-ui' | 'design-system' | 'design-spec';

  const intentId = parsed.intentId || mapToIntentId(intentGroup, parsed.jobMode, {
    environment: parsed.environment,
    figmaPopulated: options.figmaPopulated,
    hasReferences: options.hasReferences,
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

    if (intentGroup === 'design-system') {
      return {
        intentGroup, intentGroupReasoning: parsed.intentGroupReasoning ?? 'System design work detected.',
        intentId: parsed.intentId, jobMode, jobModeReasoning,
        domain: 'service',
        domainReasoning: 'Defaulted — only service domain is currently supported.',
        environment: parsed.environment === 'frontend' ? 'frontend' : parsed.environment === 'backend' ? 'backend' : 'fullstack',
        environmentReasoning: parsed.environmentReasoning || "Defaulted to 'fullstack'.",
      };
    }

    return {
      intentGroup,
      intentGroupReasoning: parsed.intentGroupReasoning
        ?? (intentGroup === 'design-ui' ? 'UI design work detected.' : 'Spec document work detected.'),
      intentId: parsed.intentId, jobMode, jobModeReasoning,
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
  const { sendClarify } = await import('../../../../../common/clarify.js');
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
  const referencesDir = path.join(featurePath, 'inputs/references');
  const assetsDir = path.join(featurePath, 'inputs/assets');

  const refFiles = await listFilesRecursive(referencesDir);
  const assetFiles = await listFilesRecursive(assetsDir);
  const hasReferences = refFiles.length > 0;
  const hasAssets = assetFiles.length > 0;

  let referencesList = '';
  if (hasReferences) {
    const grouped: Record<string, string[]> = {};
    for (const f of refFiles) {
      const sep = f.indexOf('/');
      const group = sep > 0 ? f.substring(0, sep) : '(root)';
      (grouped[group] ||= []).push(f);
    }
    const parts: string[] = [];
    for (const [group, files] of Object.entries(grouped)) {
      parts.push(`**${group}/** (${files.length} files):`);
      files.slice(0, 10).forEach(f => parts.push(`  - ${f}`));
      if (files.length > 10) parts.push(`  ... and ${files.length - 10} more`);
    }
    referencesList = parts.join('\n');
  }

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

  const uiReferences = hasReferences ? refFiles.map(f => `inputs/references/${f}`) : undefined;

  return { hasReferences, referencesList, hasAssets, assetsList, uiAssetsList, uiReferences };
}

async function fileExistsInDirs(filename: string, featurePath: string): Promise<boolean> {
  const uiDir = path.join(featurePath, DESIGN_DIR, DESIGN_SUBDIR.UI);
  const outputsDir = path.join(featurePath, DESIGN_DIR);
  for (const dir of [uiDir, outputsDir]) {
    try { await fsp.access(path.join(dir, filename)); return true; } catch { /* next */ }
  }
  return false;
}

async function hasUiDocsOnDisk(featurePath: string): Promise<boolean> {
  const tokens = await fileExistsInDirs('ui-tokens.json', featurePath);
  const assets = await fileExistsInDirs('ui-assets.json', featurePath);
  const spec = await fileExistsInDirs('ui-spec.json', featurePath);
  return tokens && assets && spec;
}
