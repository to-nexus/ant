/**
 * Code Detect Strategy
 *
 * Lightweight LLM-based detection of job mode + intentId.
 * PRD/keywords/primarySources removed — decompose uses git.listFiles() directly.
 */

import type { DetectStrategy, DetectResult } from '../../../../../common/nodes/detect/types.js';
import type { ArchitectGraphState } from '../../state.js';
import type { DetectionReport, EnvironmentHints, CodebaseProfileLike } from '@ant/shared';
import { DESIGN_DIR, DESIGN_SUBDIRS, synthesizeCodeIntent } from '@ant/shared';
import { LLM_TEMPERATURE, LLM_MAX_TOKENS } from '../../../../../common/graph/llmConfig.js';
import { createCodeDetectionReport, formatDetectionReportForChat } from '../../../../../../core/types/detection.js';
import { logPrompt } from '../../../../../../core/utils/promptLogger.js';
import { parseDetectResponse } from './responseParser.js';

export const codeDetectStrategy: DetectStrategy<ArchitectGraphState> = {
  async run(state): Promise<DetectResult<ArchitectGraphState>> {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔍 DETECT: Analyzing development context');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const llm = state.deps?.llm;
    if (!llm) throw new Error('[Code:Detect] LLM not available');

    const artifactAvailability = scanArtifacts(state);

    const promptEngine = state.deps?.promptEngine;
    if (!promptEngine) throw new Error('[Code:Detect] PromptEngine not available');

    const prompt = await promptEngine.buildDetectEnvironmentPrompt(
      state.directive || '',
      artifactAvailability,
      {
        hasDesignDoc: !!(state.design || (state.designDocs && Object.keys(state.designDocs).length > 0)),
        hasSpecDocs: !!(state.specDocs && Object.keys(state.specDocs).length > 0),
      },
    );

    const jobId = state._httpJobId || 'unknown';
    if (state.context.featurePath) {
      try {
        await logPrompt(state.context.featurePath, jobId, 'code', 'detect', prompt.length, {
          templatePath: 'code/phases/detect/base',
          usedTemplates: ['code/phases/detect/rules'],
          injectedVariables: {
            directive: state.directive ? `[${state.directive.length} chars]` : undefined,
          },
        });
      } catch { /* non-critical */ }
    }

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
      const { accumulateTokenUsage } = await import('../../../../../common/graph/llmHelpers.js');
      accumulateTokenUsage(state, capturedUsage, { taskLevel: false, jobLevel: true });
      console.log(`   Tokens: ${capturedUsage.totalTokens} total (${capturedUsage.inputTokens} in, ${capturedUsage.outputTokens} out)`);
      if (state.deps?.kanbanUpdate?.updateTokenUsage && state.tokenUsage) {
        state.deps.kanbanUpdate.updateTokenUsage(state.tokenUsage);
      }
    }

    const parsed = parseDetectResponse(response);

    const detectionReport = createCodeDetectionReport({
      detectedMode: parsed.mode as 'generate' | 'refactor' | 'explain',
      detectedModeReasoning: parsed.modeReasoning,
    });
    if (parsed.intentId) detectionReport.intentId = parsed.intentId;

    const formattedReport = formatDetectionReportForChat(detectionReport, (state._uiLocale as any) || 'ko');
    await chatAPI.sendLLMEvent({ type: 'text', text: formattedReport });
    await chatAPI.finalizeMessage();

    console.log(`✅ Job Mode: ${detectionReport.detectedMode}`);
    console.log(`   Reasoning: ${detectionReport.detectedModeReasoning}`);

    await saveToSession(state, detectionReport);

    return { detectionReport };
  },

  synthesizeFallback(report, state) {
    return synthesizeCodeIntent(report, {
      hasDesignDoc: !!(state.design || (state.designDocs && Object.keys(state.designDocs).length > 0)),
      hasSpecDocs: !!(state.specDocs && Object.keys(state.specDocs).length > 0),
    });
  },

  getCodebaseProfile(state): CodebaseProfileLike | undefined {
    return state.context?.codebaseProfile;
  },

  getExplicitHints(state): EnvironmentHints | undefined {
    return { designDocPath: state.designDocPath };
  },

  onResume(): Partial<ArchitectGraphState> {
    return {};
  },
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Internal helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function scanArtifacts(state: ArchitectGraphState): string {
  const fs = require('fs');
  const path = require('path');
  const featurePath = state.context.featurePath;
  if (!featurePath) return '';

  const lines: string[] = [];
  const listDir = (dirPath: string): string[] => {
    try {
      if (!fs.existsSync(dirPath)) return [];
      return fs.readdirSync(dirPath).filter((f: string) => !f.startsWith('.'));
    } catch { return []; }
  };

  for (const sub of DESIGN_SUBDIRS) {
    const dir = path.join(featurePath, DESIGN_DIR, sub);
    const files = listDir(dir);
    if (files.length > 0) lines.push(`- \`${DESIGN_DIR}/${sub}/\`: ${files.join(', ')}`);
  }
  const flatFiles = listDir(path.join(featurePath, DESIGN_DIR))
    .filter((f: string) => f.endsWith('.md') || f.endsWith('.json'));
  if (flatFiles.length > 0) lines.push(`- \`${DESIGN_DIR}/\` (flat): ${flatFiles.join(', ')}`);

  const sourcesDir = path.join(featurePath, 'inputs/sources');
  const sourceFiles = listDir(sourcesDir).filter((f: string) => !f.startsWith('.'));
  if (sourceFiles.length > 0) lines.push(`- \`inputs/sources/\`: ${sourceFiles.join(', ')}`);

  if (lines.length > 0) {
    const result = lines.join('\n');
    console.log(`📂 [Code:Detect] Artifact scan:\n${result}`);
    return result;
  }
  return '';
}

async function saveToSession(state: ArchitectGraphState, report: DetectionReport): Promise<void> {
  if (!state.deps?.session || !state.context.featureFolder) return;
  try {
    const session = await state.deps.session.load(state.context.project, state.context.featureFolder, 'code');
    await state.deps.session.updateArtifacts(state.context.project, state.context.featureFolder, 'code', {
      state: { ...session.state, detectionReport: report },
    });
  } catch { /* non-critical */ }
}
