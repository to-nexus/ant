/**
 * Deliver Node (Visual Graph)
 *
 * Handles final output:
 * 1. If draftImages exist (from sketch) → save and notify (image gallery for selection)
 * 2. If finalImage exists (from render) → save to inputs/assets/gen/ and notify
 * 3. If svgDrafts exist (from engrave) → save and notify
 *
 * After saving, clears temporary state (draftImages, engineeredPrompt, etc.)
 * and adds a chapter marker to conversation history.
 */

import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { VisualGraphState, VisualConversationEntry, ASSET_OUTPUT_SPECS } from '../types.js';
import { getChatAPIClient } from '../../../../../core/adapters/ChatAPIClient.js';
import { getEstimatingLabel } from '../../../../common/graph/timing/estimatingLabels.js';

export async function deliverNode(state: VisualGraphState): Promise<Partial<VisualGraphState>> {
  const phaseStart = Date.now();

  console.log('\n📦 [Visual:Deliver] Delivering output...');

  if (state.deps?.kanbanUpdate?.setEstimatingActivity) {
    state.deps.kanbanUpdate.setEstimatingActivity(getEstimatingLabel('deliver', state._uiLocale as any), 'deliver');
  }

  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.enterNode(state._httpJobId, 'deliver', 0);
  }

  const featurePath = state.featurePath;

  let result: Partial<VisualGraphState>;

  if (state.finalImage) {
    result = await deliverFinalImage(state, featurePath, phaseStart);
  } else if (state.draftImages && state.draftImages.length > 0) {
    result = await deliverDraftImages(state, featurePath, phaseStart);
  } else if (state.svgDrafts && state.svgDrafts.length > 0) {
    result = await deliverSvgDrafts(state, featurePath, phaseStart);
  } else {
    console.warn('⚠️ [Visual:Deliver] Nothing to deliver');
    result = { _phaseTimings: { ...state._phaseTimings, deliver: Date.now() - phaseStart } };
  }

  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.exitNode(state._httpJobId, 'deliver', 0);
  }

  return result;
}

async function deliverFinalImage(
  state: VisualGraphState,
  featurePath: string,
  phaseStart: number
): Promise<Partial<VisualGraphState>> {
  let imageData = state.finalImage!.data;
  let imageMime = state.finalImage!.mimeType;
  const spec = ASSET_OUTPUT_SPECS[state.assetType || 'general'];

  // Step 1: Background removal (in-memory, only when spec requires it)
  if (spec.requiresBgRemoval && state.deps?.backgroundRemoval) {
    try {
      const available = await state.deps.backgroundRemoval.isAvailable();
      if (available) {
        console.log('🔲 [Visual:Deliver] Removing background via visual-processor...');
        const chatAPI = getChatAPIClient();
        await chatAPI.showChatStatus('processing', { action: 'bg_removal', target: state.assetType || 'image' });

        const result = await state.deps.backgroundRemoval.removeBackground(imageData, imageMime);
        imageData = result.data;
        imageMime = result.mimeType;

        const sizeKB = (imageData.length / 1024).toFixed(1);
        await chatAPI.showChatStatus('processed', { action: 'bg_removal', target: state.assetType || 'image', sizeKB });
        console.log(`🔲 [Visual:Deliver] Background removed (${imageData.length} bytes)`);
      } else {
        console.warn('🔲 [Visual:Deliver] visual-processor not available, skipping bg-removal');
        const chatAPI = getChatAPIClient();
        await chatAPI.showChatStatus('processed', {
          action: 'bg_removal',
          target: state.assetType || 'image',
          error: 'visual-processor not available',
        });
      }
    } catch (err: any) {
      const chatAPI = getChatAPIClient();
      await chatAPI.showChatStatus('processed', { action: 'bg_removal', target: state.assetType || 'image', error: err.message });
      console.warn('⚠️ [Visual:Deliver] Background removal failed, using original:', err.message);
    }
  }

  // Step 2: Format conversion (in-memory, when source format != target format)
  const targetMime = `image/${spec.format}`;
  if (imageMime !== targetMime) {
    try {
      let pipeline = sharp(imageData);
      switch (spec.format) {
        case 'png':  pipeline = pipeline.png(); break;
        case 'jpeg': pipeline = pipeline.jpeg({ quality: spec.quality || 85 }); break;
        case 'webp': pipeline = pipeline.webp({ quality: spec.quality || 85 }); break;
      }
      imageData = await pipeline.toBuffer();
      imageMime = targetMime as typeof imageMime;
      console.log(`📦 [Visual:Deliver] Converted to ${spec.format} (${imageData.length} bytes)`);
    } catch (err: any) {
      console.warn('⚠️ [Visual:Deliver] Format conversion failed, using current format:', err.message);
    }
  }

  // Step 3: Single disk write with the fully processed image
  const ext = mimeToExt(imageMime);
  const timestamp = Date.now();
  const filename = `gen-${timestamp}.${ext}`;
  const outputDir = path.join(featurePath, 'inputs/assets/gen');

  fs.mkdirSync(outputDir, { recursive: true });

  const outputPath = path.join(outputDir, filename);
  fs.writeFileSync(outputPath, imageData);
  console.log(`📦 [Visual:Deliver] Saved final image: ${outputPath} (${imageData.length} bytes)`);

  // Thumbnail (flatten alpha to white for JPEG compatibility)
  let thumbnailPath: string | undefined;
  try {
    const draftsDir = path.join(outputDir, 'drafts');
    fs.mkdirSync(draftsDir, { recursive: true });
    const thumbFilename = `gen-${timestamp}-thumb.jpeg`;
    thumbnailPath = path.join(draftsDir, thumbFilename);
    await sharp(imageData)
      .flatten({ background: '#ffffff' })
      .resize(200, 200, { fit: 'inside' })
      .jpeg({ quality: 70 })
      .toFile(thumbnailPath);
  } catch (err: any) {
    console.warn('⚠️ [Visual:Deliver] Thumbnail generation failed:', err.message);
    thumbnailPath = undefined;
  }

  try {
    const chatAPI = getChatAPIClient();
    const relativePath = `inputs/assets/gen/${filename}`;
    const sizeKB = (imageData.length / 1024).toFixed(1);
    await chatAPI.showChatStatus('downloaded', {
      filename,
      sizeKB,
      imagePath: relativePath,
    });
    await chatAPI.finalizeMessage();
  } catch (err: any) {
    console.warn('⚠️ [Visual:Deliver] Chat notification failed:', err.message);
  }

  await notifyFileTree(state);

  const chapterMarker: VisualConversationEntry = {
    role: 'system',
    content: `[Asset saved: inputs/assets/gen/${filename}]`,
    timestamp: new Date().toISOString(),
    metadata: {
      savedAsset: `inputs/assets/gen/${filename}`,
      chapterSummary: `Generated ${ext.toUpperCase()} image from prompt: "${state.engineeredPrompt?.substring(0, 80)}..."`,
    },
  };

  return {
    outputPath,
    lastEngineeredPrompt: state.engineeredPrompt,
    lastOutputPath: outputPath,
    conversation: [...state.conversation, chapterMarker],
    draftImages: undefined,
    svgDrafts: undefined,
    engineeredPrompt: undefined,
    finalImage: undefined,
    selectedDraftIndex: undefined,
    routeDecision: undefined,
    needsSketches: undefined,
    isSvgRequest: undefined,
    basePrompt: undefined,
    draftVariations: undefined,
    variationAxis: undefined,
    _phaseTimings: { ...state._phaseTimings, deliver: Date.now() - phaseStart },
  };
}

async function deliverDraftImages(
  state: VisualGraphState,
  featurePath: string,
  phaseStart: number
): Promise<Partial<VisualGraphState>> {
  const drafts = state.draftImages!;
  const timestamp = Date.now();
  const outputDir = path.join(featurePath, 'inputs/assets/gen/drafts');
  fs.mkdirSync(outputDir, { recursive: true });

  const draftEntries: Array<{ index: number; imagePath: string; thumbnailPath: string }> = [];

  for (const draft of drafts) {
    const ext = mimeToExt(draft.mimeType);
    const filename = `draft-${timestamp}-${draft.index}.${ext}`;
    const thumbFilename = `draft-${timestamp}-${draft.index}-thumb.jpeg`;

    const draftPath = path.join(outputDir, filename);
    const thumbPath = path.join(outputDir, thumbFilename);

    fs.writeFileSync(draftPath, draft.data);

    try {
      await sharp(draft.data)
        .resize(200, 200, { fit: 'inside' })
        .jpeg({ quality: 70 })
        .toFile(thumbPath);
    } catch (err: any) {
      console.warn(`⚠️ [Visual:Deliver] Thumbnail failed for draft ${draft.index}:`, err.message);
    }

    draftEntries.push({
      index: draft.index,
      imagePath: `inputs/assets/gen/drafts/${filename}`,
      thumbnailPath: `inputs/assets/gen/drafts/${thumbFilename}`,
    });
  }

  console.log(`📦 [Visual:Deliver] Saved ${draftEntries.length} draft images with thumbnails`);

  const variations = state.draftVariations;

  try {
    const chatAPI = getChatAPIClient();
    await chatAPI.sendClarifyCards([{
      question: `${draftEntries.length} draft candidates`,
      options: draftEntries.map(d => ({
        label: variations?.[d.index]?.label || 'Draft',
        imagePath: d.imagePath,
        thumbnailPath: d.thumbnailPath,
        value: `draft_${d.index}`,
      })),
      allowFreeText: true,
      allowRegenerate: true,
    }]);
    await chatAPI.finalizeMessage();
  } catch (err: any) {
    console.warn('⚠️ [Visual:Deliver] Chat notification failed:', err.message);
  }

  await notifyFileTree(state);

  const chapterMarker: VisualConversationEntry = {
    role: 'system',
    content: `[${draftEntries.length} draft candidates saved for selection]`,
    timestamp: new Date().toISOString(),
    metadata: {
      chapterSummary: `Generated ${draftEntries.length} drafts from prompt: "${state.engineeredPrompt?.substring(0, 80)}..."`,
    },
  };

  const savedDraftPaths = draftEntries.map(d => path.join(featurePath, d.imagePath));

  return {
    lastEngineeredPrompt: state.basePrompt || state.engineeredPrompt,
    availableDraftPaths: savedDraftPaths,
    conversation: [...state.conversation, chapterMarker],
    draftImages: undefined,
    svgDrafts: undefined,
    engineeredPrompt: undefined,
    finalImage: undefined,
    selectedDraftIndex: undefined,
    routeDecision: undefined,
    needsSketches: undefined,
    isSvgRequest: undefined,
    _phaseTimings: { ...state._phaseTimings, deliver: Date.now() - phaseStart },
  };
}

async function deliverSvgDrafts(
  state: VisualGraphState,
  featurePath: string,
  phaseStart: number
): Promise<Partial<VisualGraphState>> {
  const drafts = state.svgDrafts!;

  if (drafts.length === 1) {
    const outputDir = path.join(featurePath, 'inputs/assets/gen');
    fs.mkdirSync(outputDir, { recursive: true });

    const filename = `gen-${Date.now()}.svg`;
    const outputPath = path.join(outputDir, filename);
    fs.writeFileSync(outputPath, drafts[0].code, 'utf-8');
    console.log(`📦 [Visual:Deliver] Saved SVG: ${outputPath}`);

    try {
      const chatAPI = getChatAPIClient();
      const relativePath = `inputs/assets/gen/${filename}`;
      const sizeKB = (Buffer.byteLength(drafts[0].code, 'utf-8') / 1024).toFixed(1);
      await chatAPI.showChatStatus('downloaded', {
        filename,
        sizeKB,
        imagePath: relativePath,
      });
      await chatAPI.finalizeMessage();
    } catch (err: any) {
      console.warn('⚠️ [Visual:Deliver] Chat notification failed:', err.message);
    }

    await notifyFileTree(state);

    const chapterMarker: VisualConversationEntry = {
      role: 'system',
      content: `[SVG saved: inputs/assets/gen/${filename}]`,
      timestamp: new Date().toISOString(),
      metadata: {
        savedAsset: `inputs/assets/gen/${filename}`,
        chapterSummary: `Generated SVG from prompt: "${state.engineeredPrompt?.substring(0, 80)}..."`,
      },
    };

    return {
      outputPath,
      lastEngineeredPrompt: state.engineeredPrompt,
      lastOutputPath: outputPath,
      conversation: [...state.conversation, chapterMarker],
      draftImages: undefined,
      svgDrafts: undefined,
      engineeredPrompt: undefined,
      finalImage: undefined,
      selectedDraftIndex: undefined,
      routeDecision: undefined,
      needsSketches: undefined,
      isSvgRequest: undefined,
      basePrompt: undefined,
      draftVariations: undefined,
      variationAxis: undefined,
      _phaseTimings: { ...state._phaseTimings, deliver: Date.now() - phaseStart },
    };
  }

  // Multiple SVG drafts: save files, generate thumbnails, use same draft selection UI as images
  const timestamp = Date.now();
  const outputDir = path.join(featurePath, 'inputs/assets/gen/drafts');
  fs.mkdirSync(outputDir, { recursive: true });

  const draftEntries: Array<{ index: number; imagePath: string; thumbnailPath: string }> = [];

  for (const draft of drafts) {
    const filename = `draft-${timestamp}-${draft.index}.svg`;
    const thumbFilename = `draft-${timestamp}-${draft.index}-thumb.jpeg`;

    const draftPath = path.join(outputDir, filename);
    const thumbPath = path.join(outputDir, thumbFilename);

    fs.writeFileSync(draftPath, draft.code, 'utf-8');

    try {
      await sharp(Buffer.from(draft.code))
        .resize(200, 200, { fit: 'inside' })
        .jpeg({ quality: 70 })
        .toFile(thumbPath);
    } catch (err: any) {
      console.warn(`⚠️ [Visual:Deliver] SVG thumbnail failed for draft ${draft.index}:`, err.message);
    }

    draftEntries.push({
      index: draft.index,
      imagePath: `inputs/assets/gen/drafts/${filename}`,
      thumbnailPath: `inputs/assets/gen/drafts/${thumbFilename}`,
    });
  }

  console.log(`📦 [Visual:Deliver] Saved ${draftEntries.length} SVG drafts with thumbnails`);

  const svgVariations = state.draftVariations;

  try {
    const chatAPI = getChatAPIClient();
    await chatAPI.sendClarifyCards([{
      question: `${draftEntries.length} draft candidates`,
      options: draftEntries.map(d => ({
        label: svgVariations?.[d.index]?.label || 'Draft',
        imagePath: d.imagePath,
        thumbnailPath: d.thumbnailPath,
        value: `draft_${d.index}`,
      })),
      allowFreeText: true,
      allowRegenerate: true,
    }]);
    await chatAPI.finalizeMessage();
  } catch (err: any) {
    console.warn('⚠️ [Visual:Deliver] Chat notification failed:', err.message);
  }

  await notifyFileTree(state);

  const chapterMarker: VisualConversationEntry = {
    role: 'system',
    content: `[${draftEntries.length} SVG draft candidates saved for selection]`,
    timestamp: new Date().toISOString(),
    metadata: {
      chapterSummary: `Generated ${draftEntries.length} SVG drafts from prompt: "${state.engineeredPrompt?.substring(0, 80)}..."`,
    },
  };

  const savedSvgDraftPaths = draftEntries.map(d => path.join(featurePath, d.imagePath));

  return {
    lastEngineeredPrompt: state.basePrompt || state.engineeredPrompt,
    availableDraftPaths: savedSvgDraftPaths,
    conversation: [...state.conversation, chapterMarker],
    draftImages: undefined,
    svgDrafts: undefined,
    engineeredPrompt: undefined,
    finalImage: undefined,
    selectedDraftIndex: undefined,
    routeDecision: undefined,
    needsSketches: undefined,
    isSvgRequest: undefined,
    _phaseTimings: { ...state._phaseTimings, deliver: Date.now() - phaseStart },
  };
}

async function notifyFileTree(state: VisualGraphState): Promise<void> {
  if (!state.deps?.fileTreeUpdate) return;
  try {
    const projectId = state.deps.session?.projectId || process.env.ANT_PROJECT_ID || 'default';
    const featureName = state.deps.session?.featureName || process.env.ANT_FEATURE_NAME || 'skeleton';
    await state.deps.fileTreeUpdate.notifyFileTreeUpdate(projectId, featureName);
  } catch (err: any) {
    console.warn('⚠️ [Visual:Deliver] FileTree update failed:', err.message);
  }
}

function mimeToExt(mime: string): string {
  switch (mime) {
    case 'image/png': return 'png';
    case 'image/jpeg': return 'jpeg';
    case 'image/webp': return 'webp';
    default: return 'png';
  }
}

