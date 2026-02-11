/**
 * Resolve Node
 * 
 * Loads existing PRD, eval reports, and recent session history
 * to build context for generation/refinement.
 */

import * as fs from 'fs';
import * as path from 'path';
import { PlanGraphState } from '../state';
import { getChatAPIClient } from '../../../../../core/adapters/ChatAPIClient';
import { WorkspacePathResolver } from '../../../../../infrastructure/workspace/WorkspaceResolver';
import { detectUILocale, getEstimatingLabel } from '../../../../common/graph/timing/estimatingLabels';

export async function resolveNode(state: PlanGraphState): Promise<Partial<PlanGraphState>> {
  console.log('\n📋 [Planner:Resolve] Loading context...');
  
  // Detect UI locale from directive
  const uiLocale = detectUILocale(state.overrideDirective || state.directive || '');
  
  // Kanban activity banner
  if (state.deps?.kanbanUpdate?.setEstimatingActivity) {
    state.deps.kanbanUpdate.setEstimatingActivity(getEstimatingLabel('resolve', uiLocale), 'resolve');
  }
  
  // Workflow instrumentation
  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.enterNode(state._httpJobId, 'resolve', 0);
  }
  
  const { featurePath } = state;
  
  // 1. Load existing PRD (if any)
  let existingDocument: string | undefined;
  const prdPath = path.join(featurePath, 'inputs/sources/prd.md');
  try {
    existingDocument = fs.readFileSync(prdPath, 'utf-8');
    
    // Check if it's just a template: file contains ant:template AND has minimal real content.
    // Strip HTML comments and whitespace, then check remaining length.
    // A real PRD with ant:template leftover at the bottom should NOT be treated as empty.
    if (existingDocument.includes('ant:template')) {
      const stripped = existingDocument.replace(/<!--[\s\S]*?-->/g, '').trim();
      if (stripped.length < 200) {
        console.log('   PRD: Template only (treated as no PRD)');
        existingDocument = undefined;
      } else {
        // Real content exists — strip the template marker and use it
        existingDocument = existingDocument
          .replace(/<!--\s*ant:template\s*-->/g, '')
          .replace(/<!--.*ant:template.*-->/g, '')
          .trim();
        console.log(`   PRD: Loaded (${existingDocument.length} chars, ant:template marker stripped)`);
      }
    } else {
      console.log(`   PRD: Loaded (${existingDocument.length} chars)`);
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
  //    NOTE: Whether to apply eval findings is decided by the LLM based on the user's directive.
  //    The system always loads available context; the prompt constrains when to use it.
  let evalReport: string | undefined;
  const evalDir = path.join(featurePath, 'outputs/evals/prd');
  try {
    const evalFiles = fs.readdirSync(evalDir)
      .filter(f => f.endsWith('.md'))
      .sort()
      .reverse();
    
    if (evalFiles.length > 0 && existingDocument) {
      const evalFileName = evalFiles[0];
      const timestampMatch = evalFileName.match(/eval-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/);
      const evalTime = timestampMatch 
        ? new Date(timestampMatch[1].replace(/-/g, (m, offset) => offset > 9 ? ':' : m)).getTime()
        : 0;
      
      const prdMtime = fs.statSync(prdPath).mtimeMs;
      
      if (evalTime > 0 && prdMtime > evalTime) {
        console.log(`   Eval: Skipped stale (${evalFileName}) — PRD modified after eval`);
      } else {
        evalReport = fs.readFileSync(path.join(evalDir, evalFileName), 'utf-8');
        console.log(`   Eval: Loaded latest (${evalFileName})`);
      }
    } else if (evalFiles.length > 0) {
      evalReport = fs.readFileSync(path.join(evalDir, evalFiles[0]), 'utf-8');
      console.log(`   Eval: Loaded latest (${evalFiles[0]})`);
    }
  } catch {
    // No eval reports
  }
  
  // 4. Rubric auto-loading removed.
  // Rubric was injected into the system prompt in refine mode, but LLMs cannot
  // reliably "ignore" 840 lines of context. It caused unintended document restructuring.
  // Rubric-based improvement should be explicitly requested via the directive.
  const rubricContent: string | undefined = undefined;
  
  // 5. Load recent session turns (lightweight context)
  let recentTurnSummaries: string[] | undefined;
  const sessionPath = path.join(featurePath, 'sessions/planner/plan.json');
  try {
    const sessionData = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
    const turns = sessionData.turns || [];
    if (turns.length > 0) {
      // Get last 2-3 turn summaries
      recentTurnSummaries = turns.slice(-3).map((t: any) => 
        `[Turn ${t.turnId}] ${t.directive?.substring(0, 100) || 'N/A'}`
      );
      console.log(`   Session: ${recentTurnSummaries?.length ?? 0} recent turns loaded`);
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
  if (recentTurnSummaries && recentTurnSummaries.length > 0) {
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
    mode,
    _uiLocale: uiLocale,
  };
}
