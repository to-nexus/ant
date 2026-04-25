/**
 * Code Detect Strategy
 *
 * LLM-based detection: returns InferredAction with valid intentId.
 * Profile/environment determination is NOT done here — that's decompose's responsibility (tech tier).
 */

import type { DetectStrategy, DetectResult } from '../../../../../common/graph/nodes/detect/types.js';
import type { ArchitectGraphState } from '../../state.js';
import type { InferredAction } from '@ant/shared';
import type { WorkspaceState } from '../../../../../common/graph/nodes/triage/types.js';
import { DESIGN_DIR } from '@ant/shared';
import { LLM_TEMPERATURE, LLM_MAX_TOKENS } from '../../../../../common/graph/llmConfig.js';
import { runEstimatingLLMStream } from '../../../../../common/graph/llmHelpers.js';
import { logPrompt } from '../../../../../../core/utils/promptLogger.js';
import { parseDetectResponse } from './responseParser.js';

export const codeDetectStrategy: DetectStrategy<ArchitectGraphState> = {
  async run(state): Promise<DetectResult<ArchitectGraphState>> {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔍 DETECT: Analyzing development context');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const llm = state.deps?.llm;
    if (!llm) throw new Error('[Code:Detect] LLM not available');

    const promptBuilder = state.deps?.promptBuilder;
    if (!promptBuilder) throw new Error('[Code:Detect] PromptBuilder not available');

    const ws = state.workspaceState;
    const prompt = await promptBuilder.render('jobs/code/nodes/detect/variants/default/base', {
      directive: state.directive || '',
      artifactAvailability: formatArtifactAvailability(ws),
      hasDesignDoc: ws?.hasSystemDesignDoc ?? false,
      hasSpecDocs: ws?.hasSpecDocs ?? false,
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

    const { response } = await runEstimatingLLMStream(
      state,
      'detect',
      () => llm.stream(
        [{ role: 'user', content: prompt }],
        { temperature: LLM_TEMPERATURE.DETECT, maxTokens: LLM_MAX_TOKENS.DEFAULT, enableThinking: false },
      ),
      () => {},
      { subNode: 'code', promptChars: prompt.length },
    );

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

/**
 * Render `artifactAvailability` block from `state.workspaceState`. Pre-RAC
 * SSOT — the Code detect LLM only needs path-based presence (filename lists)
 * to decide between `gen-code-sys` / `gen-code-spec` / `gen-code-directive` /
 * `rev-code` / `explain-code`. Content of those files is NOT injected here.
 *
 * Triage's `analyzeWorkspace` is the single disk-scan SSOT; `state.artifacts`
 * is intentionally NOT consulted (post-RAC pool — see `.cursorrules`
 * "state.artifacts Post-RAC SSOT").
 */
function formatArtifactAvailability(ws?: WorkspaceState): string {
  if (!ws) return '';
  const lines: string[] = [];
  if (ws.systemDesignFileNames?.length) {
    lines.push(`- \`${DESIGN_DIR}/system/\`: ${ws.systemDesignFileNames.join(', ')}`);
  }
  if (ws.specDocNames?.length) {
    lines.push(`- \`${DESIGN_DIR}/spec/\`: ${ws.specDocNames.join(', ')}`);
  }
  if (ws.sourceFileNames?.length) {
    lines.push(`- \`inputs/sources/\`: ${ws.sourceFileNames.join(', ')}`);
  }
  if (lines.length > 0) {
    const result = lines.join('\n');
    console.log(`📂 [Code:Detect] Artifact availability:\n${result}`);
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
