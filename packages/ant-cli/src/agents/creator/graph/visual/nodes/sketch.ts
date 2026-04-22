/**
 * Sketch Node (Visual Graph)
 *
 * Sketch exploration — generates multiple candidate images using Flash model.
 * Fast, low-cost generation for user to choose from.
 * Uses gemini-3.1-flash-image-preview (Nano Banana 2).
 */

import * as fs from 'fs';
import * as path from 'path';
import { VisualGraphState, SketchImage } from '../types.js';
import { SafetyBlockError } from '../../../../../periphery/adapters/llm/GeminiImageClient.js';
import { getEstimatingLabel } from '../../../../common/graph/timing/estimatingLabels.js';
import { logPrompt } from '../../../../../core/utils/promptLogger.js';
import { accumulateTokenUsage, upsertPhaseTokenUsage, beginNodePhase } from '../../../../common/graph/llmHelpers.js';
export async function sketchNode(state: VisualGraphState): Promise<Partial<VisualGraphState>> {
  beginNodePhase(state as any, 'sketch', 'Sketch');
  const phaseStart = Date.now();

  console.log('\n✏️ [Visual:Sketch] Generating sketch candidates...');

  if (state.deps?.kanbanUpdate?.setEstimatingActivity) {
    state.deps.kanbanUpdate.setEstimatingActivity(getEstimatingLabel('sketch', state._uiLocale === 'ko' ? 'ko' : 'en'), 'sketch');
  }

  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.enterNode(state._httpJobId, 'sketch', 0);
  }

  const imageClient = state.deps.sketchImageClient;
  const candidateCount = state.visualSettings?.candidateCount ?? 3;
  const prompt = state.engineeredPrompt || state.directive || '';
  const aspectRatio = state.resolvedAspectRatio || state.visualSettings?.defaultAspectRatio || '1:1';

  const refImage = loadSketchReference(state);
  const variations = state.sketchVariations;
  const basePrompt = state.basePrompt;
  const usePerSketchPrompts = !!basePrompt && Array.isArray(variations) && variations.length > 0;

  if (usePerSketchPrompts) {
    console.log(`✏️ [Visual:Sketch] Per-sketch variation mode: basePrompt(${basePrompt!.length} chars) + ${variations!.length} variations, ratio: ${aspectRatio}${refImage ? ' +refImage' : ''}`);
  } else {
    console.log(`✏️ [Visual:Sketch] Prompt: ${prompt.substring(0, 100)}...`);
    console.log(`✏️ [Visual:Sketch] Candidates: ${candidateCount}, ratio: ${aspectRatio}${refImage ? ' +refImage' : ''}`);
  }

  try {
    const sketchImages: SketchImage[] = [];
    let phaseInputTokens = 0;
    let phaseOutputTokens = 0;

    if (usePerSketchPrompts) {
      for (let i = 0; i < variations!.length; i++) {
        const composedPrompt = `${basePrompt} ${variations![i].prompt}`.trim();
        console.log(`✏️ [Visual:Sketch] Sketch ${i + 1}/${variations!.length}: ${composedPrompt.substring(0, 80)}...`);

        const generated = await imageClient.generate(composedPrompt, {
          numberOfImages: 1,
          outputFormat: 'jpeg',
          aspectRatio,
          temperature: 1.0,
          referenceImage: refImage,
        });

        if (generated.length > 0) {
          const genUsage = generated[0].tokenUsage;
          if (genUsage) {
            accumulateTokenUsage(state, genUsage, { taskLevel: false, jobLevel: true });
            phaseInputTokens += genUsage.inputTokens;
            phaseOutputTokens += genUsage.outputTokens;
          }
          sketchImages.push({
            data: generated[0].data,
            mimeType: generated[0].mimeType,
            prompt: composedPrompt,
            modelConfig: {
              model: (imageClient as any).modelName || 'gemini-3.1-flash-image-preview',
              aspectRatio,
            },
            modelResponseMetadata: generated[0].modelResponseMetadata || {},
            index: i,
          });
        }
      }
    } else {
      // Fallback: single prompt with numberOfImages (temperature-based variation)
      const generated = await imageClient.generate(prompt, {
        numberOfImages: candidateCount,
        outputFormat: 'jpeg',
        aspectRatio,
        temperature: 1.2,
        referenceImage: refImage,
      });

      for (let i = 0; i < generated.length; i++) {
        const genUsage = generated[i].tokenUsage;
        if (genUsage) {
          accumulateTokenUsage(state, genUsage, { taskLevel: false, jobLevel: true });
          phaseInputTokens += genUsage.inputTokens;
          phaseOutputTokens += genUsage.outputTokens;
        }
        sketchImages.push({
          data: generated[i].data,
          mimeType: generated[i].mimeType,
          prompt: generated[i].prompt,
          modelConfig: {
            model: (imageClient as any).modelName || 'gemini-3.1-flash-image-preview',
            aspectRatio,
          },
          modelResponseMetadata: generated[i].modelResponseMetadata || {},
          index: i,
        });
      }
    }

    console.log(`✏️ [Visual:Sketch] Generated ${sketchImages.length} sketches`);

    if ((phaseInputTokens > 0 || phaseOutputTokens > 0) && state.deps?.kanbanUpdate?.updateTokenUsage && state.tokenUsage) {
      state.deps.kanbanUpdate.updateTokenUsage(state.tokenUsage);
    }
    if (phaseInputTokens > 0 || phaseOutputTokens > 0) {
      upsertPhaseTokenUsage(state, 'sketch', {
        inputTokens: phaseInputTokens,
        outputTokens: phaseOutputTokens,
        totalTokens: phaseInputTokens + phaseOutputTokens,
      }, getEstimatingLabel('sketch', state._uiLocale === 'ko' ? 'ko' : 'en'));
    }

    if (state._httpJobId && state.featurePath) {
      try {
        const byteSizes = sketchImages.map((d, i) => `[sketch ${i + 1}] ${d.data.length} bytes`).join(', ');
        await logPrompt(state.featurePath, state._httpJobId, 'visual', 'sketch', prompt.length, {
          injectedVariables: { candidateCount, aspectRatio, hasReferenceImage: !!refImage, perSketchVariations: usePerSketchPrompts },
          hardcodedContent: usePerSketchPrompts
            ? `basePrompt: ${basePrompt}\nvariations: ${JSON.stringify(variations!.map(v => v.prompt))}\n\nResult: ${sketchImages.length} sketches — ${byteSizes}`
            : `engineeredPrompt: ${prompt}\n\nResult: ${sketchImages.length}/${candidateCount} sketches — ${byteSizes}`,
        });
      } catch { /* non-critical */ }
    }

    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'sketch', 0);
    }

    return {
      sketchImages,
      visualError: undefined,
      safetyBlocked: false,
      _phaseTimings: { ...state._phaseTimings, sketch: Date.now() - phaseStart },
    };
  } catch (err: any) {
    if (state._httpJobId && state.featurePath) {
      try {
        await logPrompt(state.featurePath, state._httpJobId, 'visual', 'sketch', prompt.length, {
          hardcodedContent: `engineeredPrompt: ${prompt}\n\nERROR: ${err.message}${err instanceof SafetyBlockError ? ' (SAFETY_BLOCK)' : ''}`,
        });
      } catch { /* non-critical */ }
    }

    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'sketch', 0);
    }

    if (err instanceof SafetyBlockError) {
      console.warn('🛡️ [Visual:Sketch] Safety filter blocked generation');
      return {
        sketchImages: undefined,
        visualError: 'Image generation was blocked by safety filter. Please modify your request.',
        safetyBlocked: true,
        _phaseTimings: { ...state._phaseTimings, sketch: Date.now() - phaseStart },
      };
    }

    console.error('❌ [Visual:Sketch] Generation failed:', err.message);
    return {
      sketchImages: undefined,
      visualError: `Sketch generation failed: ${err.message}`,
      _phaseTimings: { ...state._phaseTimings, sketch: Date.now() - phaseStart },
    };
  }
}

/**
 * Load a sketch as style reference for iterative sketching.
 *
 * Uses state.selectedSketchIndex when explicitly set.
 * Returns undefined (no reference) when no explicit selection —
 * prevents silently using the last sketch as reference when the
 * user did not request it.
 */
function loadSketchReference(
  state: VisualGraphState
): { data: Buffer; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' } | undefined {
  const paths = state.availableSketchPaths;
  if (!paths || paths.length === 0) return undefined;

  if (state.selectedSketchIndex == null) {
    console.log('✏️ [Visual:Sketch] No explicit sketch selection — generating without style reference');
    return undefined;
  }

  const index = state.selectedSketchIndex;
  if (index < 0 || index >= paths.length) {
    console.warn(`✏️ [Visual:Sketch] selectedSketchIndex=${index} out of range (${paths.length} sketches)`);
    return undefined;
  }

  const targetPath = paths[index];
  try {
    const fullPath = path.isAbsolute(targetPath) ? targetPath : path.join(state.featurePath, targetPath);
    if (!fs.existsSync(fullPath)) {
      console.warn(`✏️ [Visual:Sketch] Reference sketch not found: ${fullPath}`);
      return undefined;
    }

    const data = fs.readFileSync(fullPath);
    const ext = path.extname(fullPath).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png'
      : ext === '.webp' ? 'image/webp'
      : 'image/jpeg';

    console.log(`✏️ [Visual:Sketch] Using sketch #${index} as style reference: ${fullPath} (${data.length} bytes)`);
    return { data, mimeType: mimeType as any };
  } catch (err: any) {
    console.warn(`✏️ [Visual:Sketch] Failed to load reference sketch: ${err.message}`);
    return undefined;
  }
}

/**
 * Router after sketch node
 */
export function routeAfterSketch(state: VisualGraphState): string {
  if (state.safetyBlocked) {
    console.log('[SketchRouter] Safety blocked → direct (for prompt revision)');
    return 'direct';
  }

  if (state.visualError) {
    console.log('[SketchRouter] Error → __end__');
    return '__end__';
  }

  if (state.sketchImages && state.sketchImages.length > 0) {
    console.log('[SketchRouter] Sketches generated → deliver (for selection)');
    return 'deliver';
  }

  console.log('[SketchRouter] No sketches → __end__');
  return '__end__';
}
