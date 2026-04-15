/**
 * Code Detect Strategy
 *
 * LLM-based detection: returns InferredAction with valid intentId.
 * Profile/environment determination is NOT done here — that's decompose's responsibility (tech tier).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { DetectStrategy, DetectResult } from '../../../../../common/graph/nodes/detect/types.js';
import type { ArchitectGraphState } from '../../state.js';
import type { InferredAction } from '@ant/shared';
import { DESIGN_DIR, DESIGN_SUBDIRS } from '@ant/shared';
import { LLM_TEMPERATURE, LLM_MAX_TOKENS } from '../../../../../common/graph/llmConfig.js';
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

    const promptBuilder = state.deps?.promptBuilder;
    if (!promptBuilder) throw new Error('[Code:Detect] PromptBuilder not available');

    const { ArtifactPoolView } = await import('../../../../../../core/prompt/builder/ArtifactPipeline');
    const pool = new ArtifactPoolView(state.artifacts || []);
    const prompt = await promptBuilder.render('jobs/code/nodes/detect/variants/default/base', {
      directive: state.directive || '',
      artifactAvailability: artifactAvailability || '',
      hasDesignDoc: pool.hasSystemDesign(),
      hasSpecDocs: pool.hasSpec(),
    });

    const jobId = state._httpJobId || 'unknown';
    if (state.context.featurePath) {
      try {
        await logPrompt(state.context.featurePath, jobId, 'code', 'detect', prompt.length, {
          templatePath: 'jobs/code/nodes/detect/variants/default/base',
          usedTemplates: ['jobs/code/nodes/detect/variants/default/rules'],
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

    if (!parsed.intentId) {
      console.error('❌ [Code:Detect] No valid intentId from LLM. Hard fail.');
      throw new Error('[Code:Detect] LLM returned no valid intentId');
    }

    console.log(`✅ IntentId: ${parsed.intentId}`);
    if (parsed.reasoning) console.log(`   Reasoning: ${parsed.reasoning}`);

    const inferred: InferredAction = {
      intentId: parsed.intentId,
      reasoning: { intent: parsed.reasoning },
      sourceJob: 'code',
    };

    await saveToSession(state, inferred);

    return { inferred };
  },

  onResume(): Partial<ArchitectGraphState> {
    return {};
  },
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Internal helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function scanArtifacts(state: ArchitectGraphState): string {
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

async function saveToSession(state: ArchitectGraphState, inferred: InferredAction): Promise<void> {
  if (!state.deps?.session || !state.context.featureFolder) return;
  try {
    const session = await state.deps.session.load(state.context.project, state.context.featureFolder, 'code');
    await state.deps.session.updateArtifacts(state.context.project, state.context.featureFolder, 'code', {
      state: { ...session.state, lastInferredAction: inferred },
    });
  } catch { /* non-critical */ }
}
