/**
 * Engrave Node (Visual Graph)
 *
 * SVG code generation using text model (not image model).
 * For simple geometric shapes, icons, and diagrams that are better as SVG.
 * Uses gemini-3.1-pro-preview for code generation.
 * System prompt loaded from jobs/visual/nodes/engrave/variants/default/base.md template.
 */

import { VisualGraphState, SvgSketch } from '../types.js';
import { accumulateTokenUsage, beginNodePhase } from '../../../../common/graph/llmHelpers.js';
import { getEstimatingLabel } from '../../../../common/graph/timing/estimatingLabels.js';
import { logPrompt } from '../../../../../core/utils/promptLogger.js';
import { extractLLMInfo } from '../../../../../core/ports/workflow.js';

export async function engraveNode(state: VisualGraphState): Promise<Partial<VisualGraphState>> {
  beginNodePhase(state as any, 'engrave', 'Engrave');
  const phaseStart = Date.now();

  console.log('\n✒️ [Visual:Engrave] Generating SVG code...');

  if (state.deps?.kanbanUpdate?.setEstimatingActivity) {
    state.deps.kanbanUpdate.setEstimatingActivity(getEstimatingLabel('engrave', state._uiLocale as any), 'engrave');
  }

  const llm = state.deps.engraveLLM;

  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.enterNode(state._httpJobId, 'engrave', 0, undefined, llm ? extractLLMInfo(llm) : undefined);
  }
  const pb = state.deps.promptBuilder;
  const basePrompt = state.basePrompt;
  const variations = state.sketchVariations;
  const fallbackPrompt = state.engineeredPrompt || state.directive || '';
  const candidateCount = state.visualSettings?.candidateCount ?? 3;
  const usePerSketchPrompts = !!basePrompt && Array.isArray(variations) && variations.length > 0;

  const systemPrompt = await pb.render('jobs/visual/nodes/engrave/variants/default/base', {});

  const svgSketches: SvgSketch[] = [];
  const sketchCount = usePerSketchPrompts ? variations!.length : candidateCount;

  for (let i = 0; i < sketchCount; i++) {
    let sketchPrompt: string;
    if (usePerSketchPrompts) {
      sketchPrompt = `${basePrompt} ${variations![i].prompt}`.trim();
    } else {
      const variationHint = candidateCount > 1
        ? `\n\nThis is variation ${i + 1} of ${candidateCount}. ${i > 0 ? 'Create a different style/approach from previous variations.' : ''}`
        : '';
      sketchPrompt = fallbackPrompt + variationHint;
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: sketchPrompt },
    ];

    try {
      let svgCode: string;
      if (llm.invokeWithUsage) {
        const response = await llm.invokeWithUsage(messages);
        svgCode = response.content;
        if (response.usage) {
          accumulateTokenUsage(state, response.usage, { taskLevel: true, jobLevel: true });
        }
      } else {
        svgCode = await llm.invoke(messages);
      }

      svgCode = svgCode.trim();
      if (svgCode.startsWith('```')) {
        svgCode = svgCode.replace(/^```(?:svg|xml)?\n?/, '').replace(/\n?```$/, '');
      }

      svgSketches.push({ code: svgCode, prompt: sketchPrompt, index: i });
      console.log(`✒️ [Visual:Engrave] SVG variation ${i + 1} generated (${svgCode.length} chars)`);
    } catch (err: any) {
      console.error(`❌ [Visual:Engrave] Variation ${i + 1} failed:`, err.message);
    }
  }

  if (state._httpJobId && state.featurePath) {
    try {
      const svgSummary = svgSketches.map((d, i) => `[variation ${i + 1}] ${d.code.length} chars`).join(', ');
      const promptLen = systemPrompt.length + (usePerSketchPrompts ? basePrompt!.length : fallbackPrompt.length);
      await logPrompt(state.featurePath, state._httpJobId, 'visual', 'engrave', promptLen, {
        templatePath: 'jobs/visual/nodes/engrave/variants/default/base',
        usedTemplates: ['jobs/visual/nodes/engrave/variants/default/base', 'jobs/visual/nodes/engrave/variants/default/rules'],
        injectedVariables: { basePrompt: basePrompt || fallbackPrompt, candidateCount: sketchCount, perSketchVariations: usePerSketchPrompts },
        hardcodedContent: `Generated ${svgSketches.length}/${sketchCount} SVGs: ${svgSummary}`,
      });
    } catch { /* non-critical */ }
  }

  if (state.deps?.kanbanUpdate?.updateTokenUsage && state.tokenUsage) {
    state.deps.kanbanUpdate.updateTokenUsage(state.tokenUsage as any);
  }

  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.exitNode(state._httpJobId, 'engrave', 0);
  }

  if (svgSketches.length === 0) {
    return {
      svgSketches: undefined,
      visualError: 'SVG generation failed — no valid output produced',
      _phaseTimings: { ...state._phaseTimings, engrave: Date.now() - phaseStart },
    };
  }

  console.log(`✒️ [Visual:Engrave] Generated ${svgSketches.length} SVG sketches`);

  return {
    svgSketches,
    visualError: undefined,
    _phaseTimings: { ...state._phaseTimings, engrave: Date.now() - phaseStart },
  };
}

/**
 * Router after engrave node
 */
export function routeAfterEngrave(state: VisualGraphState): string {
  if (state.svgSketches && state.svgSketches.length > 0) {
    console.log('[EngraveRouter] SVG sketches generated → deliver');
    return 'deliver';
  }

  console.log('[EngraveRouter] No SVG sketches → __end__');
  return '__end__';
}
