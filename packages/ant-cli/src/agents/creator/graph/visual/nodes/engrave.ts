/**
 * Engrave Node (Visual Graph)
 *
 * SVG code generation using text model (not image model).
 * For simple geometric shapes, icons, and diagrams that are better as SVG.
 * Uses gemini-3.1-pro-preview for code generation.
 * System prompt loaded from jobs/visual/nodes/engrave/variants/default/base.md template.
 */

import { VisualGraphState, SvgSketch } from '../types.js';
import { LLM_TEMPERATURE } from '../../../../common/graph/llmConfig';
import { accumulateTokenUsage, broadcastTokenUsageByModel, TokenUsage } from '../../../../common/graph/llmHelpers.js';
import { getEstimatingLabel } from '../../../../common/graph/timing/estimatingLabels.js';
import { logPrompt } from '../../../../../core/utils/promptLogger.js';
import { TEMPLATE_PATHS } from '../../../../../core/prompt/builder/templatePaths';
import { extractLLMInfo } from '../../../../../core/ports/workflow.js';

export async function engraveNode(state: VisualGraphState): Promise<Partial<VisualGraphState>> {
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

  const systemPrompt = await pb.render(TEMPLATE_PATHS.visualEngrave.base, {});

  const svgSketches: SvgSketch[] = [];
  const sketchCount = usePerSketchPrompts ? variations!.length : candidateCount;

  const buildSketchPrompt = (i: number): string => {
    if (usePerSketchPrompts) {
      return `${basePrompt} ${variations![i].prompt}`.trim();
    }
    const variationHint = candidateCount > 1
      ? `\n\nThis is variation ${i + 1} of ${candidateCount}. ${i > 0 ? 'Create a different style/approach from previous variations.' : ''}`
      : '';
    return fallbackPrompt + variationHint;
  };

  // Generate all SVG candidates in parallel — the calls are independent, so a
  // sequential await-loop needlessly multiplied wall-clock. Token accumulation
  // runs afterwards in index order so accounting stays deterministic.
  const rawResults = await Promise.all(
    Array.from({ length: sketchCount }, async (_unused, i): Promise<{ i: number; sketchPrompt: string; svgCode?: string; usage?: TokenUsage; error?: any }> => {
      const sketchPrompt = buildSketchPrompt(i);
      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: sketchPrompt },
      ];
      try {
        if (llm.invokeWithUsage) {
          const response = await llm.invokeWithUsage(messages, { enableThinking: false, temperature: LLM_TEMPERATURE.CODE_EXECUTE });
          return { i, sketchPrompt, svgCode: response.content, usage: response.usage };
        }
        return { i, sketchPrompt, svgCode: await llm.invoke(messages, { enableThinking: false, temperature: LLM_TEMPERATURE.CODE_EXECUTE }) };
      } catch (err: any) {
        return { i, sketchPrompt, error: err };
      }
    })
  );

  for (const result of rawResults) {
    if (result.error) {
      console.error(`❌ [Visual:Engrave] Variation ${result.i + 1} failed:`, result.error.message);
      continue;
    }
    if (result.usage) {
      accumulateTokenUsage(state, result.usage, { taskLevel: true, jobLevel: true });
    }

    let svgCode = (result.svgCode || '').trim();
    if (svgCode.startsWith('```')) {
      svgCode = svgCode.replace(/^```(?:svg|xml)?\n?/, '').replace(/\n?```$/, '').trim();
    }

    // Robustly extract the <svg>…</svg> region. The model sometimes wraps the
    // SVG in prose ("Here is the logo:") or adds a trailing note, leaving the
    // saved file starting with a non-`<` char — then both sharp/librsvg AND
    // the browser fail to render it (log: "Start tag expected '<' not found").
    const svgMatch = svgCode.match(/<svg[\s\S]*<\/svg>/i);
    if (svgMatch) svgCode = svgMatch[0];

    // Validate: a complete SVG element must open with <svg and close with
    // </svg>. A truncated generation (log: "Couldn't find end of Start Tag")
    // has no closing tag and must be dropped, not saved as a broken candidate.
    const isValidSvg = /^<svg[\s>]/i.test(svgCode) && /<\/svg>\s*$/i.test(svgCode);
    if (!isValidSvg) {
      console.error(`❌ [Visual:Engrave] Variation ${result.i + 1} produced invalid/incomplete SVG — dropped`);
      continue;
    }

    svgSketches.push({ code: svgCode, prompt: result.sketchPrompt, index: result.i });
    console.log(`✒️ [Visual:Engrave] SVG variation ${result.i + 1} generated (${svgCode.length} chars)`);
  }

  if (state._httpJobId && state.featurePath) {
    try {
      const svgSummary = svgSketches.map((d, i) => `[variation ${i + 1}] ${d.code.length} chars`).join(', ');
      const promptLen = systemPrompt.length + (usePerSketchPrompts ? basePrompt!.length : fallbackPrompt.length);
      await logPrompt(state.featurePath, state._httpJobId, 'visual', 'engrave', promptLen, {
        templatePath: TEMPLATE_PATHS.visualEngrave.base,
        usedTemplates: [TEMPLATE_PATHS.visualEngrave.base, TEMPLATE_PATHS.visualEngrave.rules!],
        injectedVariables: { basePrompt: basePrompt || fallbackPrompt, candidateCount: sketchCount, perSketchVariations: usePerSketchPrompts },
        hardcodedContent: `Generated ${svgSketches.length}/${sketchCount} SVGs: ${svgSummary}`,
      });
    } catch { /* non-critical */ }
  }

  if (state.deps?.kanbanUpdate?.updateTokenUsage && state.tokenUsage) {
    broadcastTokenUsageByModel(state as any);
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
