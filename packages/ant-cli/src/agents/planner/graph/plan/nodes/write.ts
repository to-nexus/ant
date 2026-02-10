/**
 * Write Node
 * 
 * Writes the generated PRD to outputs/plan/prd-refine.md (staging),
 * shows a file card in the UI, and sends a choice card asking the user
 * whether to apply the PRD to inputs/sources/prd.md.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { PlanGraphState } from '../state';
import { getChatAPIClient } from '../../../../../core/adapters/ChatAPIClient';
import { getEstimatingLabel } from '../../../../common/graph/timing/estimatingLabels';

export async function writeNode(state: PlanGraphState): Promise<Partial<PlanGraphState>> {
  const content = state.generatedDocument;
  if (!content) {
    console.warn('[Planner:Write] No document to write');
    return {};
  }
  
  // Kanban activity banner
  if (state.deps?.kanbanUpdate?.setEstimatingActivity) {
    state.deps.kanbanUpdate.setEstimatingActivity(getEstimatingLabel('write', state._uiLocale || 'en'), 'write');
  }
  
  // Workflow instrumentation
  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.enterNode(state._httpJobId, 'write', 0);
  }
  
  // Stage to outputs/plan/prd-refine.md (not directly to inputs/)
  const stagingPath = path.join(state.featurePath, 'outputs/plan/prd-refine.md');
  const relativePath = 'outputs/plan/prd-refine.md';
  
  console.log(`\n📝 [Planner:Write] Writing PRD draft to ${relativePath}`);
  
  // Stream file creation to UI
  const chatAPI = getChatAPIClient();
  
  try {
    // Ensure directory exists
    await fs.mkdir(path.dirname(stagingPath), { recursive: true });
    
    // Show file card in UI
    await chatAPI.startFileCreation(relativePath);
    await chatAPI.streamFileContent(relativePath, content);
    
    // Write file to staging location
    await fs.writeFile(stagingPath, content, 'utf-8');
    
    await chatAPI.completeFileCreation(relativePath, content);
    
    console.log(`   ✅ Written ${content.length} chars to staging`);
  } catch (error: any) {
    console.error(`   ❌ Failed to write PRD draft: ${error.message}`);
    throw error;
  }
  
  // Record session turn
  try {
    const session = state.deps?.session;
    if (session) {
      const projectId = process.env.ANT_PROJECT_ID || 'default';
      const featureName = process.env.ANT_FEATURE_NAME || 'skeleton';
      
      await session.addTurn(projectId, featureName, 'plan', {
        directive: state.directive,
        mode: state.mode,
        timestamp: new Date().toISOString(),
        tokenUsage: state.tokenUsage,
      });
      console.log('   ✅ Session turn recorded');
    }
  } catch (error: any) {
    console.warn(`   ⚠️ Failed to record session turn: ${error.message}`);
  }
  
  // Send PRD apply choice card
  try {
    await chatAPI.sendChoiceCard({
      type: 'prd_apply',
      title: state.language === 'ko' 
        ? '📋 PRD를 inputs/sources/prd.md에 적용하시겠습니까?'
        : '📋 Apply this PRD to inputs/sources/prd.md?',
      choices: [
        {
          id: 'apply',
          label: state.language === 'ko' ? '적용' : 'Apply',
          action: 'prd_apply',
        },
        {
          id: 'keep_draft',
          label: state.language === 'ko' ? '초안 유지' : 'Keep as draft',
          action: 'dismiss',
        },
      ],
    });
    console.log('📋 [Planner:Write] PRD apply choice card sent');
  } catch (error) {
    console.warn('⚠️ [Planner:Write] Failed to send PRD apply choice card:', error);
  }
  
  // Finalize chat message
  await chatAPI.finalizeMessage();
  
  // Workflow instrumentation
  if (state.deps?.workflowUpdate && state._httpJobId) {
    state.deps.workflowUpdate.exitNode(state._httpJobId, 'write', 0);
  }
  
  return {};
}
