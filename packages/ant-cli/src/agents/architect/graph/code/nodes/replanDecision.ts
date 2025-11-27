import { LLMClient } from "../../../../../core/ports";
import { ArchitectGraphState } from "../state";
import Handlebars from 'handlebars';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Replan Decision Node
 * 
 * Responsibilities:
 * 1. Check if this is a "continue with new directive" scenario
 * 2. Ask LLM to decide: continue / modify / restart
 * 3. Store decision in state for routing
 */
export async function replanDecision(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  state.recursionCount = (state.recursionCount || 0) + 1;
  
  const llm = state.deps?.llm as LLMClient;
  
  if (state.deps?.workflowUpdate && state._httpJobId) {
    const taskInfo = state.currentTask ? {
      id: state.currentTask.id,
      name: state.currentTask.name,
      type: state.currentTask.type,
      description: state.currentTask.description,
      priority: state.currentTask.priority
    } : undefined;
    
    const llmInfo = (llm as any)?.provider && (llm as any)?.modelName ? {
      provider: (llm as any).provider,
      model: (llm as any).modelName
    } : undefined;
    
    await state.deps.workflowUpdate.enterNode(
      state._httpJobId,
      'replanDecision',
      taskInfo,
      llmInfo,
      state.recursionCount,
      state.recursionLimit
    );
  }
  
  // 1. Check if this is a continue scenario (multiple directives)
  const directives = state.directives || [];
  
  if (directives.length < 2) {
    console.log('📋 [ReplanDecision] Single directive detected → CONTINUE (no replan needed)\n');
    
    if (state.deps?.workflowUpdate && state._httpJobId) {
      state.deps.workflowUpdate.exitNode(state._httpJobId, 'replanDecision');
    }
    
    return {
      ...state,
      replanAction: 'continue',
      replanReason: 'Single directive - normal flow',
      tasksToModify: []
    };
  }
  
  // 2. Multiple directives detected - ask LLM for decision
  console.log(`\n🔍 [ReplanDecision] Multiple directives detected (${directives.length})`);
  console.log(`   Original: "${directives[directives.length - 1].substring(0, 60)}..."`);
  console.log(`   New:      "${directives[0].substring(0, 60)}..."`);
  console.log('   Analyzing impact...\n');
  
  try {
    // 3. Load prompt template
    const templatePath = path.join(
      __dirname,
      '../../../../../core/prompt/templates/code/replan-decision.md'
    );
    const templateContent = fs.readFileSync(templatePath, 'utf-8');
    const template = Handlebars.compile(templateContent);
    
    // 4. Prepare template data
    const completedCount = state.completedTasks?.length || 0;
    const remainingTasks = state.taskQueue?.getAll() || [];
    const totalTasks = completedCount + remainingTasks.length + (state.currentTask ? 1 : 0);
    
    const completedTasksList = state.completedTasksDetails?.map(t => ({
      name: t.name,
      type: t.type
    })) || [];
    
    // Newest = [0], Oldest = [length-1]
    const originalDirective = directives[directives.length - 1];
    const newFeedback = directives[0];
    
    const promptData = {
      context: state.context,
      completedCount,
      totalTasks,
      currentTask: state.currentTask,
      remainingTasks: remainingTasks.map((t, idx) => ({
        ...t,
        index: idx
      })),
      completedTasksList,
      originalDirective,
      newFeedback
    };
    
    // 5. Generate prompt
    const prompt = template(promptData);
    
    console.log('🤖 [ReplanDecision] Asking LLM for decision...');
    
    // 6. Call LLM
    const response = await llm.generateText({
      prompt,
      systemPrompt: 'You are a technical project manager analyzing user feedback to decide on plan adjustments. Always respond with valid JSON only.',
      temperature: 0.3,  // Low temperature for consistent decisions
      maxTokens: 500
    });
    
    // 7. Parse JSON response
    let decision: {
      action: 'continue' | 'modify' | 'restart';
      reason: string;
      tasksToModify: string[];
      confidence?: number;
    };
    
    try {
      // Clean response (remove markdown code blocks if present)
      let cleanResponse = response.trim();
      if (cleanResponse.startsWith('```json')) {
        cleanResponse = cleanResponse.replace(/```json\n?/, '').replace(/\n?```$/, '');
      } else if (cleanResponse.startsWith('```')) {
        cleanResponse = cleanResponse.replace(/```\n?/, '').replace(/\n?```$/, '');
      }
      
      decision = JSON.parse(cleanResponse);
      
      // Validate
      if (!['continue', 'modify', 'restart'].includes(decision.action)) {
        throw new Error(`Invalid action: ${decision.action}`);
      }
      
      console.log(`\n✅ [ReplanDecision] Decision: ${decision.action.toUpperCase()}`);
      console.log(`   Reason: ${decision.reason}`);
      if (decision.confidence) {
        console.log(`   Confidence: ${(decision.confidence * 100).toFixed(0)}%`);
      }
      if (decision.tasksToModify && decision.tasksToModify.length > 0) {
        console.log(`   Tasks to modify: ${decision.tasksToModify.join(', ')}`);
      }
      console.log('');
      
    } catch (parseError) {
      console.error('❌ [ReplanDecision] Failed to parse LLM response as JSON');
      console.error('   Response:', response);
      console.error('   Error:', parseError);
      console.log('   Falling back to CONTINUE (safe default)\n');
      
      decision = {
        action: 'continue',
        reason: 'Failed to parse LLM decision - defaulting to continue',
        tasksToModify: []
      };
    }
    
    // 8. Store decision in state
    const updatedState: ArchitectGraphState = {
      ...state,
      replanAction: decision.action,
      replanReason: decision.reason,
      tasksToModify: decision.tasksToModify || []
    };
    
    if (state.deps?.workflowUpdate && state._httpJobId) {
      state.deps.workflowUpdate.exitNode(state._httpJobId, 'replanDecision');
    }
    
    return updatedState;
    
  } catch (error) {
    console.error('❌ [ReplanDecision] Error during decision making:', error);
    console.log('   Falling back to CONTINUE (safe default)\n');
    
    if (state.deps?.workflowUpdate && state._httpJobId) {
      state.deps.workflowUpdate.exitNode(state._httpJobId, 'replanDecision');
    }
    
    return {
      ...state,
      replanAction: 'continue',
      replanReason: `Error during decision: ${error instanceof Error ? error.message : 'Unknown error'}`,
      tasksToModify: []
    };
  }
}

