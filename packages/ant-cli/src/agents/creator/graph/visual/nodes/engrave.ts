/**
 * Engrave Node (Visual Graph)
 *
 * SVG code generation using text model (not image model).
 * For simple geometric shapes, icons, and diagrams that are better as SVG.
 * Uses gemini-3.1-pro-preview for code generation.
 * System prompt loaded from visual/nodes/engrave/base.md template.
 */

import { VisualGraphState, SvgDraft } from '../types.js';
import { accumulateTokenUsage } from '../../../../common/graph/llmHelpers.js';
import { getEstimatingLabel } from '../../../../common/graph/timing/estimatingLabels.js';
import { logPrompt } from '../../../../../core/utils/promptLogger.js';
export async function engraveNode(state: VisualGraphState): Promise<Partial<VisualGraphState>> {
  const phaseStart = Date.now();

  console.log('\n✒️ [Visual:Engrave] Generating SVG code...');

  if (state.deps?.kanbanUpdate?.setEstimatingActivity) {
    state.deps.kanbanUpdate.setEstimatingActivity(getEstimatingLabel('engrave', state._uiLocale as any), 'engrave');
  }

  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.enterNode(state._httpJobId, 'engrave', 0);
  }

  const llm = state.deps.engraveLLM;
  const promptPort = state.deps.promptPort;
  const basePrompt = state.basePrompt;
  const variations = state.draftVariations;
  const fallbackPrompt = state.engineeredPrompt || state.directive || '';
  const candidateCount = state.visualSettings?.candidateCount ?? 3;
  const usePerDraftPrompts = !!basePrompt && Array.isArray(variations) && variations.length > 0;

  const systemPrompt = await promptPort.render('visual/nodes/engrave/base', {});

  const svgDrafts: SvgDraft[] = [];
  const draftCount = usePerDraftPrompts ? variations!.length : candidateCount;

  for (let i = 0; i < draftCount; i++) {
    let draftPrompt: string;
    if (usePerDraftPrompts) {
      draftPrompt = `${basePrompt} ${variations![i].prompt}`.trim();
    } else {
      const variationHint = candidateCount > 1
        ? `\n\nThis is variation ${i + 1} of ${candidateCount}. ${i > 0 ? 'Create a different style/approach from previous variations.' : ''}`
        : '';
      draftPrompt = fallbackPrompt + variationHint;
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: draftPrompt },
    ];

    try {
      let svgCode: string;
      if (llm.invokeWithUsage) {
        const response = await llm.invokeWithUsage(messages);
        svgCode = response.content;
        if (response.usage) {
          accumulateTokenUsage(state as any, response.usage, { taskLevel: true, jobLevel: true });
        }
      } else {
        svgCode = await llm.invoke(messages);
      }

      svgCode = svgCode.trim();
      if (svgCode.startsWith('```')) {
        svgCode = svgCode.replace(/^```(?:svg|xml)?\n?/, '').replace(/\n?```$/, '');
      }

      svgDrafts.push({ code: svgCode, prompt: draftPrompt, index: i });
      console.log(`✒️ [Visual:Engrave] SVG variation ${i + 1} generated (${svgCode.length} chars)`);
    } catch (err: any) {
      console.error(`❌ [Visual:Engrave] Variation ${i + 1} failed:`, err.message);
    }
  }

  if (state._httpJobId) {
    try {
      const svgSummary = svgDrafts.map((d, i) => `[variation ${i + 1}] ${d.code.length} chars`).join(', ');
      const promptLen = systemPrompt.length + (usePerDraftPrompts ? basePrompt!.length : fallbackPrompt.length);
      await logPrompt(state.featurePath, state._httpJobId, 'visual', 'engrave', promptLen, {
        templatePath: 'visual/nodes/engrave/base',
        usedTemplates: ['visual/nodes/engrave/base', 'visual/nodes/engrave/rules'],
        injectedVariables: { basePrompt: basePrompt || fallbackPrompt, candidateCount: draftCount, perDraftVariations: usePerDraftPrompts },
        hardcodedContent: `Generated ${svgDrafts.length}/${draftCount} SVGs: ${svgSummary}`,
      });
    } catch { /* non-critical */ }
  }

  if (state.deps?.kanbanUpdate?.updateTokenUsage && state.tokenUsage) {
    state.deps.kanbanUpdate.updateTokenUsage(state.tokenUsage as any);
  }

  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.exitNode(state._httpJobId, 'engrave', 0);
  }

  if (svgDrafts.length === 0) {
    return {
      svgDrafts: undefined,
      visualError: 'SVG generation failed — no valid output produced',
      _phaseTimings: { ...state._phaseTimings, engrave: Date.now() - phaseStart },
    };
  }

  console.log(`✒️ [Visual:Engrave] Generated ${svgDrafts.length} SVG drafts`);

  return {
    svgDrafts,
    visualError: undefined,
    _phaseTimings: { ...state._phaseTimings, engrave: Date.now() - phaseStart },
  };
}

/**
 * Router after engrave node
 */
export function routeAfterEngrave(state: VisualGraphState): string {
  if (state.svgDrafts && state.svgDrafts.length > 0) {
    console.log('[EngraveRouter] SVG drafts generated → deliver');
    return 'deliver';
  }

  console.log('[EngraveRouter] No SVG drafts → __end__');
  return '__end__';
}
