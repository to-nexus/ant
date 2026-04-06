/**
 * Render Node (Visual Graph)
 *
 * Final high-quality rendering using Pro model.
 * Uses gemini-3-pro-image-preview (Nano Banana Pro).
 * Receives refined prompt from direct node.
 */

import * as fs from 'fs';
import * as path from 'path';
import { VisualGraphState } from '../types.js';
import { SafetyBlockError } from '../../../../../periphery/adapters/llm/GeminiImageClient.js';
import { getEstimatingLabel } from '../../../../common/graph/timing/estimatingLabels.js';
import { logPrompt } from '../../../../../core/utils/promptLogger.js';
import type { ImageGenerationOptions } from '../../../../../core/ports/imageGeneration.js';
export async function renderNode(state: VisualGraphState): Promise<Partial<VisualGraphState>> {
  const phaseStart = Date.now();

  console.log('\n🎨 [Visual:Render] Final high-quality rendering...');

  if (state.deps?.kanbanUpdate?.setEstimatingActivity) {
    state.deps.kanbanUpdate.setEstimatingActivity(getEstimatingLabel('render', state._uiLocale as any), 'render');
  }

  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.enterNode(state._httpJobId, 'render', 0);
  }

  const imageClient = state.deps.renderImageClient;
  let prompt = state.engineeredPrompt || state.directive || '';
  const aspectRatio = state.resolvedAspectRatio || state.visualSettings?.defaultAspectRatio || '1:1';

  console.log(`🎨 [Visual:Render] Prompt: ${prompt.substring(0, 100)}...`);
  console.log(`🎨 [Visual:Render] Ratio: ${aspectRatio}`);

  const genOptions: ImageGenerationOptions = {
    numberOfImages: 1,
    aspectRatio,
    temperature: 0.3,
  };

  const refImage = loadReferenceImage(state);
  if (refImage) {
    genOptions.referenceImage = refImage;
    try {
      prompt = await state.deps.promptPort.render('visual/nodes/render/fidelity-prefix', { engineeredPrompt: prompt });
    } catch (err: any) {
      console.warn(`🎨 [Visual:Render] Fidelity template failed, using raw prompt: ${err.message}`);
    }
    console.log(`🎨 [Visual:Render] Using reference image (${refImage.data.length} bytes, ${refImage.mimeType}) with fidelity constraint`);
  }

  try {
    const generated = await imageClient.generate(prompt, genOptions);

    if (generated.length === 0) {
      return {
        finalImage: undefined,
        visualError: 'Render produced no output',
        _phaseTimings: { ...state._phaseTimings, render: Date.now() - phaseStart },
      };
    }

    const finalImage = generated[0];
    console.log(`🎨 [Visual:Render] Rendered final image (${finalImage.data.length} bytes)`);

    if (state._httpJobId) {
      try {
        await logPrompt(state.featurePath, state._httpJobId, 'visual', 'render', prompt.length, {
          injectedVariables: { aspectRatio, selectedSketchIndex: state.selectedSketchIndex, hasReferenceImage: !!refImage },
          hardcodedContent: `engineeredPrompt: ${prompt}\n\nResult: ${finalImage.data.length} bytes, mimeType=${finalImage.mimeType}`,
        });
      } catch { /* non-critical */ }
    }

    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'render', 0);
    }

    return {
      finalImage,
      visualError: undefined,
      safetyBlocked: false,
      _phaseTimings: { ...state._phaseTimings, render: Date.now() - phaseStart },
    };
  } catch (err: any) {
    if (state._httpJobId) {
      try {
        await logPrompt(state.featurePath, state._httpJobId, 'visual', 'render', prompt.length, {
          hardcodedContent: `engineeredPrompt: ${prompt}\n\nERROR: ${err.message}${err instanceof SafetyBlockError ? ' (SAFETY_BLOCK)' : ''}`,
        });
      } catch { /* non-critical */ }
    }

    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'render', 0);
    }

    if (err instanceof SafetyBlockError) {
      console.warn('🛡️ [Visual:Render] Safety filter blocked generation');
      return {
        finalImage: undefined,
        visualError: 'Final rendering was blocked by safety filter. Please modify your request.',
        safetyBlocked: true,
        _phaseTimings: { ...state._phaseTimings, render: Date.now() - phaseStart },
      };
    }

    console.error('❌ [Visual:Render] Rendering failed:', err.message);
    return {
      finalImage: undefined,
      visualError: `Render failed: ${err.message}`,
      _phaseTimings: { ...state._phaseTimings, render: Date.now() - phaseStart },
    };
  }
}

/**
 * Router after render node
 */
export function routeAfterRender(state: VisualGraphState): string {
  if (state.safetyBlocked) {
    console.log('[RenderRouter] Safety blocked → direct (for prompt revision)');
    return 'direct';
  }

  if (state.finalImage) {
    console.log('[RenderRouter] Final image ready → deliver');
    return 'deliver';
  }

  console.log('[RenderRouter] No final image → __end__');
  return '__end__';
}

/**
 * Load an image from an absolute or feature-relative path.
 */
function loadImageFromPath(
  imagePath: string,
  featurePath: string,
): { data: Buffer; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' } | undefined {
  try {
    const fullPath = path.isAbsolute(imagePath) ? imagePath : path.join(featurePath, imagePath);
    if (!fs.existsSync(fullPath)) return undefined;

    const data = fs.readFileSync(fullPath);
    const ext = path.extname(fullPath).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png'
      : ext === '.webp' ? 'image/webp'
      : 'image/jpeg';

    return { data, mimeType: mimeType as any };
  } catch {
    return undefined;
  }
}

/**
 * Load a reference image for rendering.
 *
 * Priority:
 *   1. explicit selectedSketchIndex → load that sketch
 *   2. lastOutputPath → the final rendered image is the baseline
 *   3. auto-select latest sketch (fallback)
 */
function loadReferenceImage(
  state: VisualGraphState
): { data: Buffer; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' } | undefined {
  const explicitIndex = state.selectedSketchIndex;
  const sketchPaths = state.availableSketchPaths;

  // Priority 1: explicit sketch selection
  if (explicitIndex != null && sketchPaths && sketchPaths.length > 0) {
    const sketchPath = sketchPaths[explicitIndex];
    if (!sketchPath) {
      console.warn(`🎨 [Visual:Render] selectedSketchIndex=${explicitIndex} out of range (${sketchPaths.length} sketches)`);
      return undefined;
    }

    const loaded = loadImageFromPath(sketchPath, state.featurePath);
    if (loaded) {
      console.log(`🎨 [Visual:Render] Loaded sketch #${explicitIndex}: ${sketchPath} (${loaded.data.length} bytes)`);
    } else {
      console.warn(`🎨 [Visual:Render] Sketch file not found: ${sketchPath}`);
    }
    return loaded;
  }

  // Priority 2: finalized output
  if (state.lastOutputPath) {
    const loaded = loadImageFromPath(state.lastOutputPath, state.featurePath);
    if (loaded) {
      console.log(`🎨 [Visual:Render] Using final output as reference: ${state.lastOutputPath} (${loaded.data.length} bytes)`);
      return loaded;
    }
    console.warn('🎨 [Visual:Render] lastOutputPath not found, falling back to sketches');
  }

  // Priority 3: auto-select last sketch
  if (!sketchPaths || sketchPaths.length === 0) return undefined;

  const index = sketchPaths.length - 1;
  console.warn(
    `🎨 [Visual:Render] WARNING: No explicit sketch selection. ` +
    `Auto-selecting last sketch #${index} as fallback.`
  );

  const sketchPath = sketchPaths[index];
  const loaded = loadImageFromPath(sketchPath, state.featurePath);
  if (loaded) {
    console.log(`🎨 [Visual:Render] Loaded sketch #${index}: ${sketchPath} (${loaded.data.length} bytes)`);
  } else {
    console.warn(`🎨 [Visual:Render] Sketch file not found: ${sketchPath}`);
  }
  return loaded;
}
