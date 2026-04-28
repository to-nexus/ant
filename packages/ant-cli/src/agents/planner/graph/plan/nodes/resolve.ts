/**
 * Plan Resolve Strategy
 *
 * Determines target, loads documents, loads eval reports and
 * session history. Mode detection and RAC creation are handled
 * by the downstream detect node.
 *
 * Target resolution (3 cases):
 *   1. Explicit: actionMetadata.target from UI
 *   2. Infer + canonical plan file exists (prd.md for service / gdd.md
 *      for game): pick the domain-canonical one if present, fall back
 *      to the other plan filename if the workspace happens to carry it
 *   3. Infer + no plan file + other sources: all source files (LLM clarifies)
 *
 * Domain comes from `actionMetadata.domain` when explicit; otherwise it
 * is unknown at resolve time (detect runs after this node) and we
 * default to `'service'` semantics (`prd.md`).
 */

import * as fs from 'fs';
import * as path from 'path';
import { PlanGraphState } from '../state';
import type { ConversationEntry } from '../../../../../core/types/session';
import { CONV_KEYS, getConv, type ConversationMessage } from '../../../../common/graph/conversations';
import { buildSessionDigest } from '../../../../common/graph/utils/sessionDigest';
import { getChatAPIClient } from '../../../../../core/adapters/ChatAPIClient';
import { normalizeTemplateDoc } from '../../../../../core/utils/templateDetector';
import {
  getCanonicalPlanPath,
  pickExistingPlanFilename,
  type ResolvedArtifact,
} from '@ant/shared';
import type { ResolveStrategy } from '../../../../common/graph/nodes/resolve/types';

export const planResolveStrategy: ResolveStrategy<PlanGraphState> = {
  async loadArtifacts(state) {
    return loadPlanContext(state);
  },

  async onResume(state) {
    return loadPlanContext(state);
  },
};

/**
 * Shared logic for both new and resume paths.
 * Plan resolve doesn't distinguish — it always loads context.
 */
async function loadPlanContext(state: PlanGraphState): Promise<Partial<PlanGraphState>> {
  console.log('\n📋 [Planner:Resolve] Loading context...');

  const { featurePath } = state;
  const actionMetadata = state.actionMetadata;

  // 1. Resolve target
  const isExplicit = !!actionMetadata?.intent;
  const isExplainIntent = actionMetadata?.intent === 'explain-plan';
  // Domain is known here only when caller supplied it explicitly.
  // Detect runs after resolve, so an inferred domain is not available
  // yet — fall back to service semantics (`prd.md`).
  const explicitDomain = actionMetadata?.domain;
  let targets: string[];

  if (actionMetadata?.target?.length) {
    targets = actionMetadata.target;
    console.log(`   Target (explicit): ${targets.join(', ')}`);
  } else if (isExplicit && !isExplainIntent) {
    console.error(`   ❌ Target missing for explicit intent: ${actionMetadata?.intent}`);
    targets = [];
  } else {
    const planFileNames = state.workspaceState?.planFileNames;
    const existingPlanFile = pickExistingPlanFilename(planFileNames, explicitDomain);
    if (existingPlanFile) {
      targets = [`plan/${existingPlanFile}`];
      console.log(`   Target (infer): ${existingPlanFile} found`);
    } else if (planFileNames?.length) {
      targets = planFileNames.map((f: string) => `plan/${f}`);
      console.log(`   Target (infer/clarify): ${targets.length} source files, LLM will clarify`);
    } else {
      targets = [];
      console.log(`   Target: none — generate mode`);
    }
  }

  // 2. Check if target documents exist
  const hasExistingTarget = targets.length > 0 && targets.some(t => {
    try {
      const raw = fs.readFileSync(path.join(featurePath, t), 'utf-8');
      return !!normalizeTemplateDoc(raw);
    } catch { return false; }
  });

  // 3. Infer default target
  if (targets.length === 0 && !isExplicit) {
    const fallbackTarget = getCanonicalPlanPath(explicitDomain);
    targets = [fallbackTarget];
    console.log(`   Target (infer default): ${fallbackTarget}`);
  }

  // 4. Load refs/context content
  const documents: ResolvedArtifact[] = [];
  const refPaths = actionMetadata?.refs || (targets.length ? targets : []);
  for (const refPath of refPaths) {
    try {
      const raw = fs.readFileSync(path.join(featurePath, refPath), 'utf-8');
      const content = normalizeTemplateDoc(raw);
      if (content) documents.push({ path: refPath, content, role: 'ref' });
    } catch { /* file not found */ }
  }
  for (const ctxPath of actionMetadata?.context || []) {
    try {
      const content = fs.readFileSync(path.join(featurePath, ctxPath), 'utf-8');
      if (content.trim()) documents.push({ path: ctxPath, content, role: 'context' });
    } catch { /* file not found */ }
  }
  if (documents.length > 0) {
    console.log(`   Documents: ${documents.length} loaded (${documents.filter(d => d.role === 'ref').length} ref, ${documents.filter(d => d.role === 'context').length} context)`);
  }

  // 5. Load eval reports (skip stale evals)
  let evalReport: string | undefined;
  const evalDir = path.join(featurePath, 'meta/evals/prd');
  try {
    const evalFiles = fs.readdirSync(evalDir).filter(f => f.endsWith('.md')).sort().reverse();
    if (evalFiles.length > 0) {
      const evalFileName = evalFiles[0];
      const evalFilePath = path.join(evalDir, evalFileName);
      if (hasExistingTarget && targets[0]) {
        const evalMtime = fs.statSync(evalFilePath).mtimeMs;
        const targetMtime = fs.statSync(path.join(featurePath, targets[0])).mtimeMs;
        if (targetMtime > evalMtime) {
          console.log(`   Eval: Skipped stale (${evalFileName}) — target modified after eval`);
        } else {
          evalReport = fs.readFileSync(evalFilePath, 'utf-8');
          console.log(`   Eval: Loaded latest (${evalFileName})`);
        }
      } else {
        evalReport = fs.readFileSync(evalFilePath, 'utf-8');
        console.log(`   Eval: Loaded latest (${evalFileName})`);
      }
    }
  } catch { /* No eval reports */ }

  const rubricContent: string | undefined = undefined;

  // 6. Load multi-turn conversation + recent session turns
  let sessionMain: ConversationMessage[] = [];
  let nodeGenerate: ConversationMessage[] = [];
  let isConversationContinuation = false;
  let nodeHistoryReset = false;
  let recentTurnSummaries: string[] | undefined;
  const sessionPath = path.join(featurePath, 'sessions/planner/plan.json');
  try {
    const sessionData = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));

    // Load from new format first, fallback to legacy
    if (sessionData.state?.conversations?.[CONV_KEYS.SESSION_MAIN]) {
      sessionMain = sessionData.state.conversations[CONV_KEYS.SESSION_MAIN];
      console.log(`   Conversation: ${sessionMain.length} entries loaded from session`);
    }

    if (sessionData.state?.conversations?.[CONV_KEYS.NODE_GENERATE]) {
      nodeGenerate = sessionData.state.conversations[CONV_KEYS.NODE_GENERATE];
    }

    const shouldContinueConversation = sessionMain.length > 0 && state.overrideDirective && (
      state.isResume || state.chatSource
    );
    if (shouldContinueConversation) {
      sessionMain.push({
        role: 'user',
        content: state.overrideDirective!,
        timestamp: new Date().toISOString(),
      });
      isConversationContinuation = true;
      console.log(`   Conversation: Appended new user message (now ${sessionMain.length} entries)`);
      try {
        const sessionWriteData = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
        sessionWriteData.state = sessionWriteData.state || {};
        sessionWriteData.state.conversations = {
          ...sessionWriteData.state.conversations,
          [CONV_KEYS.SESSION_MAIN]: sessionMain,
        };
        sessionWriteData.updatedAt = new Date().toISOString();
        fs.writeFileSync(sessionPath, JSON.stringify(sessionWriteData, null, 2), 'utf-8');
        console.log(`   Conversation: Persisted to session (crash-safe)`);
      } catch (err: any) {
        console.warn(`   ⚠️ Conversation: Failed to persist: ${err.message}`);
      }
    }

    if (!isConversationContinuation && state.isResume && sessionMain.length > 0) {
      const lastEntry = sessionMain[sessionMain.length - 1];
      if (lastEntry.role === 'user' && lastEntry.content) {
      isConversationContinuation = true;
      nodeHistoryReset = true;
        console.log(`   Conversation: Resuming pending user turn (${sessionMain.length} entries)`);
      }
    }

    const runs = sessionData.runs || [];
    if (runs.length > 0) {
      recentTurnSummaries = runs.slice(-3).map((t: any) =>
        `[Run ${t.runId}] ${t.input?.summary?.substring(0, 100) || 'N/A'}`
      );
      console.log(`   Session: ${recentTurnSummaries?.length ?? 0} recent runs loaded`);
    }
  } catch { /* No session history */ }

  // Notify user about loaded context
  const contextItems: Array<{ label: string; detail?: string }> = [];
  if (documents.length > 0) {
    for (const doc of documents.filter(d => d.role === 'ref')) {
      contextItems.push({ label: path.basename(doc.path), detail: `${doc.content.length.toLocaleString()} chars` });
    }
  }
  if (evalReport) {
    const latestEvalFile = fs.readdirSync(evalDir).filter(f => f.endsWith('.md')).sort().reverse()[0];
    contextItems.push({ label: 'Eval report', detail: latestEvalFile });
  }
  if (sessionMain.length > 0) {
    contextItems.push({ label: 'Conversation', detail: `${sessionMain.length} messages` });
  } else if (recentTurnSummaries && recentTurnSummaries.length > 0) {
    contextItems.push({ label: 'Session history', detail: `${recentTurnSummaries.length} turns` });
  }
  if (contextItems.length > 0) {
    const chatAPI = getChatAPIClient();
    await chatAPI.showContextLoaded(contextItems);
  }

  return {
    evalReport,
    rubricContent,
    recentTurnSummaries,
    conversations: {
      [CONV_KEYS.SESSION_MAIN]: sessionMain,
      ...(nodeGenerate.length > 0 && !nodeHistoryReset
        ? { [CONV_KEYS.NODE_GENERATE]: nodeGenerate }
        : { [CONV_KEYS.NODE_GENERATE]: [] }),
    },
    isConversationContinuation,
    resolvedArtifacts: documents.length > 0 ? documents : undefined,
    sessionDigest: buildSessionDigest(sessionMain),
  } as Partial<PlanGraphState>;
}
