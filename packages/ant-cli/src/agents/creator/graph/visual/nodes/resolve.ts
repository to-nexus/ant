/**
 * Resolve Node (Visual Graph)
 *
 * Loads session state and determines if this is a continuation or fresh start.
 * Pattern aligned with planner resolve node.
 */

import * as fs from 'fs';
import * as path from 'path';
import { VisualGraphState, VisualConversationEntry, DraftVariation } from '../types.js';
import { getEstimatingLabel, detectUILocale } from '../../../../common/graph/timing/estimatingLabels.js';

export async function resolveNode(state: VisualGraphState): Promise<Partial<VisualGraphState>> {
  const phaseStart = Date.now();

  console.log('\n📂 [Visual:Resolve] Loading session state...');

  if (state.deps?.kanbanUpdate?.setEstimatingActivity) {
    const locale = state._uiLocale || detectUILocale(state.directive);
    state.deps.kanbanUpdate.setEstimatingActivity(getEstimatingLabel('resolve', locale as any), 'resolve');
  }

  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.enterNode(state._httpJobId, 'resolve', 0);
  }

  const featurePath = state.featurePath;
  if (!featurePath) {
    console.warn('⚠️ [Visual:Resolve] No featurePath — starting fresh');
    return { _phaseTimings: { resolve: Date.now() - phaseStart } };
  }

  const sessionPath = path.join(featurePath, 'sessions/creator/visual.json');
  let conversation: VisualConversationEntry[] = [];
  let isResume = state.isResume ?? false;
  let lastEngineeredPrompt: string | undefined;
  let lastOutputPath: string | undefined;
  let lastAssetType: string | undefined;
  let lastJobMode: string | undefined;
  let availableDraftPaths: string[] | undefined;
  let lastBasePrompt: string | undefined;
  let lastDraftVariations: DraftVariation[] | undefined;
  let clarifyCount = state.clarifyCount || 0;

  try {
    if (fs.existsSync(sessionPath)) {
      const sessionData = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));

      if (sessionData.state?.conversation && Array.isArray(sessionData.state.conversation)) {
        conversation = sessionData.state.conversation;
        console.log(`📂 [Visual:Resolve] Loaded ${conversation.length} conversation entries`);
      }

      if (sessionData.state?.lastEngineeredPrompt) {
        lastEngineeredPrompt = sessionData.state.lastEngineeredPrompt;
        console.log(`📂 [Visual:Resolve] Restored lastEngineeredPrompt (${lastEngineeredPrompt!.length} chars)`);
      }
      if (sessionData.state?.lastOutputPath) {
        lastOutputPath = sessionData.state.lastOutputPath;
        console.log(`📂 [Visual:Resolve] Restored lastOutputPath: ${lastOutputPath}`);
      }
      if (sessionData.state?.assetType) {
        lastAssetType = sessionData.state.assetType;
        console.log(`📂 [Visual:Resolve] Restored assetType: ${lastAssetType}`);
      }
      if (sessionData.state?.jobMode) {
        lastJobMode = sessionData.state.jobMode;
        console.log(`📂 [Visual:Resolve] Restored jobMode: ${lastJobMode}`);
      }
      if (sessionData.state?.availableDraftPaths && Array.isArray(sessionData.state.availableDraftPaths)) {
        availableDraftPaths = sessionData.state.availableDraftPaths;
        console.log(`📂 [Visual:Resolve] Restored availableDraftPaths from session (${availableDraftPaths!.length} paths)`);
      }
      if (sessionData.state?.basePrompt) {
        lastBasePrompt = sessionData.state.basePrompt;
        console.log(`📂 [Visual:Resolve] Restored basePrompt (${lastBasePrompt!.length} chars)`);
      }
      if (sessionData.state?.draftVariations && Array.isArray(sessionData.state.draftVariations)) {
        lastDraftVariations = sessionData.state.draftVariations;
        console.log(`📂 [Visual:Resolve] Restored draftVariations (${lastDraftVariations!.length} variations)`);
      }

      // Restore clarify count from conversation (count assistant→user pairs)
      if (conversation.length > 0) {
        clarifyCount = conversation.filter((e, i) =>
          e.role === 'assistant' && !e.metadata?.savedAsset && conversation[i + 1]?.role === 'user'
        ).length;
        console.log(`📂 [Visual:Resolve] Restored clarifyCount: ${clarifyCount}`);
      }

      if (sessionData.state?.interruption) {
        isResume = true;
        console.log('🔄 [Visual:Resolve] Found interrupted session — resuming');
      }
    }
  } catch (err) {
    console.warn('⚠️ [Visual:Resolve] Failed to load session:', err);
  }

  // Fallback: scan drafts directory only if session didn't provide availableDraftPaths
  if (!availableDraftPaths) {
    const draftsDir = path.join(featurePath, 'inputs/assets/gen/drafts');
    try {
      if (fs.existsSync(draftsDir)) {
        const files = fs.readdirSync(draftsDir)
          .filter(f => /^draft-\d+-\d+\.(jpeg|jpg|png|webp|svg)$/i.test(f))
          .sort();
        if (files.length > 0) {
          // Only keep the latest batch (highest timestamp) to prevent cross-batch index mismatch
          const timestamps = files.map(f => f.match(/^draft-(\d+)-/)?.[1]).filter(Boolean) as string[];
          const latestTs = timestamps.sort().pop();
          const latestFiles = latestTs ? files.filter(f => f.startsWith(`draft-${latestTs}-`)) : files;
          availableDraftPaths = latestFiles.map(f => path.join(draftsDir, f));
          console.log(`📂 [Visual:Resolve] Fallback scan: ${availableDraftPaths.length} draft files (latest batch of ${files.length} total)`);
        }
      }
    } catch (err) {
      console.warn('⚠️ [Visual:Resolve] Failed to scan drafts directory:', err);
    }
  }

  const userDirective = state.overrideDirective || state.directive;

  // Parse structured draft intent from overrideDirective prefix
  let draftIntent: VisualGraphState['draftIntent'];
  let isDraftFeedback = false;
  let selectedDraftIndex: number | undefined;
  let parsedDirective = userDirective;

  const intentMatch = userDirective?.match(
    /^\[DRAFT_(FINALIZE|REGENERATE|FEEDBACK)(?::(\d+))?\](?:\s*(.*))?$/s
  );
  if (intentMatch) {
    const [, action, indexStr, rest] = intentMatch;
    if (action === 'FINALIZE') {
      draftIntent = 'finalize';
      selectedDraftIndex = indexStr != null ? parseInt(indexStr, 10) : undefined;
      parsedDirective = `Selected draft ${(selectedDraftIndex ?? 0) + 1} for final rendering`;
      console.log(`📂 [Visual:Resolve] Draft intent: finalize (draft ${selectedDraftIndex})`);
    } else if (action === 'REGENERATE') {
      draftIntent = 'regenerate';
      parsedDirective = 'Requested draft regeneration with fresh exploration';
      console.log('📂 [Visual:Resolve] Draft intent: regenerate');
    } else if (action === 'FEEDBACK') {
      isDraftFeedback = true;
      parsedDirective = rest?.trim() || userDirective;
      console.log(`📂 [Visual:Resolve] Draft feedback: "${parsedDirective?.substring(0, 60)}"`);
    }
  }

  if (userDirective) {
    conversation.push({
      role: 'user',
      content: parsedDirective || userDirective,
      timestamp: new Date().toISOString(),
    });
    console.log('📝 [Visual:Resolve] Appended user directive to conversation');
  }

  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.exitNode(state._httpJobId, 'resolve', 0);
  }

  const result: Partial<VisualGraphState> = {
    conversation,
    isResume,
    lastEngineeredPrompt,
    lastOutputPath,
    availableDraftPaths,
    clarifyCount,
    draftIntent,
    isDraftFeedback,
    selectedDraftIndex,
    directive: parsedDirective || state.overrideDirective || state.directive,
    overrideDirective: parsedDirective || state.overrideDirective,
    _uiLocale: state._uiLocale || detectUILocale(state.directive),
    _phaseTimings: { ...state._phaseTimings, resolve: Date.now() - phaseStart },
  };

  // Detect clarify response: last session conversation entry is an assistant clarify question (not a draft delivery)
  const lastConvBeforeUser = conversation.length >= 2 ? conversation[conversation.length - 2] : null;
  const isClarifyResponse = !!lastConvBeforeUser
    && lastConvBeforeUser.role === 'assistant'
    && !lastConvBeforeUser.metadata?.savedAsset
    && !draftIntent
    && !isDraftFeedback;

  // Skip triage + classify for all visual continuations (draft interactions + clarify responses)
  if (draftIntent || isDraftFeedback || isClarifyResponse) {
    result.skipTriage = true;
    result.skipClassify = true;
    if (lastAssetType) {
      result.assetType = lastAssetType as any;
    }
    if (lastJobMode) {
      result.jobMode = lastJobMode as any;
    }
    if (lastBasePrompt) {
      result.basePrompt = lastBasePrompt;
    }
    if (lastDraftVariations) {
      result.draftVariations = lastDraftVariations;
    }
    const bypassReason = draftIntent ? `draft:${draftIntent}` : isDraftFeedback ? 'draftFeedback' : 'clarifyResponse';
    console.log(`📂 [Visual:Resolve] skipTriage+skipClassify=true (reason=${bypassReason}, assetType=${lastAssetType || 'general'}, jobMode=${lastJobMode || 'generate'})`);
  }

  return result;
}
