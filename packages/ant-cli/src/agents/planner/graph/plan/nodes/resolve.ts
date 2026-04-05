/**
 * Resolve Node
 * 
 * Loads existing PRD, eval reports, and recent session history
 * to build context for generation/refinement.
 */

import * as fs from 'fs';
import * as path from 'path';
import { PlanGraphState } from '../state';
import { ConversationEntry } from '../../../../../core/types/session';
import { getChatAPIClient } from '../../../../../core/adapters/ChatAPIClient';
import { WorkspacePathResolver } from '../../../../../infrastructure/workspace/WorkspaceResolver';
import { detectUILocale, getEstimatingLabel } from '../../../../common/graph/timing/estimatingLabels';
import { normalizeTemplateDoc } from '../../../../../core/utils/templateDetector';

export async function resolveNode(state: PlanGraphState): Promise<Partial<PlanGraphState>> {
  console.log('\n📋 [Planner:Resolve] Loading context...');
  
  // Detect UI locale from directive
  const uiLocale = detectUILocale(state.overrideDirective || state.directive || '');
  
  // Kanban activity banner
  if (state.deps?.kanbanUpdate?.setEstimatingActivity) {
    state.deps.kanbanUpdate.setEstimatingActivity(getEstimatingLabel('resolve', uiLocale), 'resolve');
  }
  
  // Workflow instrumentation (pass recursion info for badge display)
  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.enterNode(
      state._httpJobId, 'resolve', 0,
      undefined, undefined,
      state.recursionCount, state.recursionLimit,
    );
  }
  
  const { featurePath } = state;
  
  // 1. Load existing PRD (if any)
  let existingDocument: string | undefined;
  const prdPath = path.join(featurePath, 'inputs/sources/prd.md');
  try {
    const raw = fs.readFileSync(prdPath, 'utf-8');
    existingDocument = normalizeTemplateDoc(raw) ?? undefined;
    if (existingDocument) {
      console.log(`   PRD: Loaded (${existingDocument.length} chars)`);
    } else {
      console.log('   PRD: Template only (treated as no PRD)');
    }
  } catch (err: any) {
    console.log(`   PRD: Not found (${err.code || err.message})`);
  }
  
  // 2. Determine mode
  const mode = existingDocument ? 'refine' : 'generate';
  console.log(`   Mode: ${mode}`);
  
  // 2b. In refine mode, create staging copy for edit_prd tool
  if (mode === 'refine' && existingDocument) {
    const stagingDir = path.join(featurePath, 'outputs/plan');
    const stagingPath = path.join(stagingDir, 'prd-refine.md');
    try {
      fs.mkdirSync(stagingDir, { recursive: true });
      fs.writeFileSync(stagingPath, existingDocument, 'utf-8');
      console.log(`   Staging: Created outputs/plan/prd-refine.md (${existingDocument.length} chars)`);
      
      // ✅ Notify file tree update after staging copy creation
      if (state.deps?.fileTreeUpdate) {
        const projectId = process.env.ANT_PROJECT_ID;
        const featureName = process.env.ANT_FEATURE_NAME;
        if (projectId && featureName) {
          state.deps.fileTreeUpdate.notifyFileTreeUpdate(projectId, featureName);
        }
      }
    } catch (error: any) {
      console.warn(`   ⚠️ Staging: Failed to create staging copy: ${error.message}`);
    }
  }
  
  // 3. Load eval reports (if any) — skip stale evals (PRD modified after eval)
  //    Uses file mtime for comparison (not filename timestamp) to avoid timezone bugs.
  //    Whether to apply eval findings is decided by the LLM based on the user's directive.
  let evalReport: string | undefined;
  const evalDir = path.join(featurePath, 'outputs/evals/prd');
  try {
    const evalFiles = fs.readdirSync(evalDir)
      .filter(f => f.endsWith('.md'))
      .sort()
      .reverse();
    
    if (evalFiles.length > 0) {
      const evalFileName = evalFiles[0];
      const evalFilePath = path.join(evalDir, evalFileName);
      
      if (existingDocument) {
        // Compare file mtimes directly (avoids UTC/local timezone mismatch from filename parsing)
        const evalMtime = fs.statSync(evalFilePath).mtimeMs;
        const prdMtime = fs.statSync(prdPath).mtimeMs;
        
        if (prdMtime > evalMtime) {
          console.log(`   Eval: Skipped stale (${evalFileName}) — PRD modified after eval`);
        } else {
          evalReport = fs.readFileSync(evalFilePath, 'utf-8');
          console.log(`   Eval: Loaded latest (${evalFileName})`);
        }
      } else {
        evalReport = fs.readFileSync(evalFilePath, 'utf-8');
        console.log(`   Eval: Loaded latest (${evalFileName})`);
      }
    }
  } catch {
    // No eval reports
  }
  
  // 4. Rubric auto-loading removed.
  // Rubric was injected into the system prompt in refine mode, but LLMs cannot
  // reliably "ignore" 840 lines of context. It caused unintended document restructuring.
  // Rubric-based improvement should be explicitly requested via the directive.
  const rubricContent: string | undefined = undefined;
  
  // 5. Load multi-turn conversation + recent session turns
  let conversation: ConversationEntry[] = [];
  let isConversationContinuation = false;
  let conversationHistoryReset = false;
  let recentTurnSummaries: string[] | undefined;
  const sessionPath = path.join(featurePath, 'sessions/planner/plan.json');
  try {
    const sessionData = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
    
    // 5a. Load conversation from session state (multi-turn history)
    if (sessionData.state?.conversation && Array.isArray(sessionData.state.conversation)) {
      conversation = sessionData.state.conversation;
      console.log(`   Conversation: ${conversation.length} entries loaded from session`);
    }
    
    // 5b. If this is a conversation continuation, append the new user message.
    //     Two triggers:
    //       - Resume/Continue: isResume + overrideDirective  (from /continue endpoint)
    //       - Chat follow-up:  chatSource + overrideDirective (from clarify answer submit or ChatInput)
    //     Both require an existing conversation to append to.
    const shouldContinueConversation = conversation.length > 0 && state.overrideDirective && (
      state.isResume || state.chatSource
    );
    if (shouldContinueConversation) {
      conversation.push({
        role: 'user',
        content: state.overrideDirective!,
        timestamp: new Date().toISOString(),
      });
      isConversationContinuation = true;
      console.log(`   Conversation: Appended new user message (now ${conversation.length} entries)`);
      
      // ✅ Save updated conversation to session immediately (crash safety).
      // Without this, if the job is stopped before generate.ts saves, the appended
      // user message is lost — causing the LLM to repeat clarifying questions on resume.
      try {
        const sessionWriteData = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
        sessionWriteData.state = sessionWriteData.state || {};
        sessionWriteData.state.conversation = conversation;
        sessionWriteData.updatedAt = new Date().toISOString();
        fs.writeFileSync(sessionPath, JSON.stringify(sessionWriteData, null, 2), 'utf-8');
        console.log(`   Conversation: Persisted to session (crash-safe)`);
      } catch (err: any) {
        console.warn(`   ⚠️ Conversation: Failed to persist: ${err.message}`);
      }
    }
    
    // 5b-2. Resume without new directive: check if conversation has a pending user turn.
    // This happens when the previous job was stopped after resolve appended the user's
    // clarify answers but before generate could process them.
    // conversationHistory from the prior run is stale (doesn't include answers),
    // so we reset it to force generate.ts to use conversation's last user message.
    if (!isConversationContinuation && state.isResume && conversation.length > 0) {
      const lastEntry = conversation[conversation.length - 1];
      if (lastEntry.role === 'user' && lastEntry.content) {
        isConversationContinuation = true;
        conversationHistoryReset = true;
        console.log(`   Conversation: Resuming pending user turn (${conversation.length} entries)`);
      }
    }
    
    // 5c. Load recent run summaries (fallback context for non-conversation runs)
    const runs = sessionData.runs || [];
    if (runs.length > 0) {
      recentTurnSummaries = runs.slice(-3).map((t: any) => 
        `[Run ${t.runId}] ${t.input?.summary?.substring(0, 100) || 'N/A'}`
      );
      console.log(`   Session: ${recentTurnSummaries?.length ?? 0} recent runs loaded`);
    }
  } catch {
    // No session history
  }
  
  // Notify user about loaded context
  const contextItems: Array<{ label: string; detail?: string }> = [];
  if (existingDocument) {
    contextItems.push({ label: 'PRD', detail: `${existingDocument.length.toLocaleString()} chars` });
  }
  if (evalReport) {
    const latestEvalFile = fs.readdirSync(evalDir).filter(f => f.endsWith('.md')).sort().reverse()[0];
    contextItems.push({ label: 'Eval report', detail: latestEvalFile });
  }
  // Rubric context item removed (rubric auto-loading disabled)
  if (conversation.length > 0) {
    contextItems.push({ label: 'Conversation', detail: `${conversation.length} messages` });
  } else if (recentTurnSummaries && recentTurnSummaries.length > 0) {
    contextItems.push({ label: 'Session history', detail: `${recentTurnSummaries.length} turns` });
  }
  if (contextItems.length > 0) {
    const chatAPI = getChatAPIClient();
    await chatAPI.showContextLoaded(contextItems);
  }
  
  // Workflow instrumentation
  if (state.deps?.workflowUpdate && state._httpJobId) {
    state.deps.workflowUpdate.exitNode(state._httpJobId, 'resolve', 0);
  }
  
  return {
    existingDocument,
    evalReport,
    rubricContent,
    recentTurnSummaries,
    conversation,
    isConversationContinuation,
    // Reset stale conversationHistory when resuming a pending user turn.
    // Without this, generate.ts uses the old [user, assistant] history instead of
    // the conversation's last user message (clarify answers).
    ...(conversationHistoryReset ? { conversationHistory: [] } : {}),
    mode,
    _uiLocale: uiLocale,
  };
}
