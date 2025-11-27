import { ArchitectGraphState } from '../state';

/**
 * Replan Router - Route based on LLM's replan decision
 * 
 * Routes:
 * - continue → plan (proceed with current plan)
 * - modify → modifyTasks (adjust specific tasks)
 * - restart → clearStateForReplan (reset and decompose again)
 */
export function routeAfterReplanDecision(state: ArchitectGraphState): string {
  const action = state.replanAction;
  
  console.log(`🚦 [ReplanRouter] Routing based on action: ${action}`);
  
  switch (action) {
    case 'continue':
      console.log('   → Continuing with current plan (plan node)\n');
      return 'plan';
    
    case 'modify':
      console.log('   → Modifying specific tasks (modifyTasks node)\n');
      return 'modifyTasks';
    
    case 'restart':
      console.log('   → Restarting with new plan (clearStateForReplan → decompose)\n');
      return 'clearStateForReplan';
    
    default:
      console.warn(`⚠️  [ReplanRouter] Unknown action: ${action}, falling back to plan`);
      return 'plan';
  }
}

