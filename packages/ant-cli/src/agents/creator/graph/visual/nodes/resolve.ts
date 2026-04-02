/**
 * Resolve Node (Visual Graph)
 *
 * Loads session state and determines if this is a continuation or fresh start.
 * Pattern aligned with planner resolve node.
 */

import * as fs from 'fs';
import * as path from 'path';
import { VisualGraphState, VisualConversationEntry } from '../types.js';
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
  let availableDraftPaths: string[] | undefined;
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

  // Scan drafts directory for available draft files (used by render for reference image)
  const draftsDir = path.join(featurePath, 'inputs/assets/gen/drafts');
  try {
    if (fs.existsSync(draftsDir)) {
      const files = fs.readdirSync(draftsDir)
        .filter(f => /^draft-\d+-\d+\.(jpeg|jpg|png|webp|svg)$/i.test(f))
        .sort();
      if (files.length > 0) {
        availableDraftPaths = files.map(f => path.join(draftsDir, f));
        console.log(`📂 [Visual:Resolve] Found ${availableDraftPaths.length} draft files`);
      }
    }
  } catch (err) {
    console.warn('⚠️ [Visual:Resolve] Failed to scan drafts directory:', err);
  }

  const userDirective = state.overrideDirective || state.directive;
  if (userDirective) {
    conversation.push({
      role: 'user',
      content: userDirective,
      timestamp: new Date().toISOString(),
    });
    console.log('📝 [Visual:Resolve] Appended user directive to conversation');
  }

  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.exitNode(state._httpJobId, 'resolve', 0);
  }

  return {
    conversation,
    isResume,
    lastEngineeredPrompt,
    lastOutputPath,
    availableDraftPaths,
    clarifyCount,
    directive: state.overrideDirective || state.directive,
    _uiLocale: state._uiLocale || detectUILocale(state.directive),
    _phaseTimings: { ...state._phaseTimings, resolve: Date.now() - phaseStart },
  };
}
