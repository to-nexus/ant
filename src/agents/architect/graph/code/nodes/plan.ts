import { LLMClient } from "../../../../../core/ports";
import { ArchitectGraphState, AttemptHistory } from "../state";
import { PromptEngine } from "../../../../../core/prompt/engine";

/**
 * Format previous attempts for LLM context
 * Shows what was tried before to avoid repetition
 */
function formatPreviousAttempts(attempts: AttemptHistory[]): string {
  if (!attempts || attempts.length === 0) {
    return 'No previous attempts recorded.';
  }
  
  const formatted = attempts.map(attempt => {
    const lines = [
      `\n### Attempt #${attempt.attemptNumber}${attempt.subtaskName ? ` (${attempt.subtaskName})` : ''}`,
    ];
    
    if (attempt.keyChanges.length > 0) {
      lines.push('**Changes made:**');
      attempt.keyChanges.forEach(change => {
        lines.push(`  - ${change}`);
      });
    } else {
      lines.push('**Changes made:** None (no files generated)');
    }
    
    if (attempt.filesGenerated.length > 0) {
      lines.push(`**Files created:** ${attempt.filesGenerated.join(', ')}`);
    }
    
    return lines.join('\n');
  }).join('\n');
  
  return formatted;
}

/**
 * Ask LLM to analyze errors and create/update subtasks
 * Returns null if no subtask changes needed
 */
async function analyzeSubtasks(
  llm: LLMClient,
  violations: string[],
  currentSubtask: any,
  remainingSubtasks: any[],
  previousAttempts: AttemptHistory[]
): Promise<any> {
  const violationsText = violations.join('\n\n');
  const attemptsText = formatPreviousAttempts(previousAttempts);
  
  const prompt = `You are analyzing build/validation errors to create an execution strategy.

CURRENT ERRORS (${violations.length} total):
${violationsText}

PREVIOUS ATTEMPTS:
${attemptsText}

${currentSubtask ? `CURRENT SUBTASK: ${currentSubtask.name}
REMAINING SUBTASKS: ${remainingSubtasks.map((s: any) => s.name).join(', ')}
` : 'NO SUBTASKS YET'}

YOUR TASK:
1. Analyze all errors and identify logical groups
2. Determine if subtasks need to be created/updated:
   - If no subtasks exist: CREATE them
   - If errors changed significantly: UPDATE subtasks
   - If current plan is still valid: KEEP current subtasks

3. Prioritize by ROOT CAUSE and DEPENDENCY ORDER:
   - Missing ENTRY FILES (index.html, main.tsx) = HIGHEST (priority: 100)
     * These block the entire build process
     * Must be CREATED, not worked around by config changes
   
   - Missing DEPENDENCIES = VERY HIGH (priority: 90)
     * Check for PEER DEPENDENCIES!
     * Example: @vitejs/plugin-react needs react AND react-dom
     * Example: TypeScript packages need @types/* packages
     * Include ALL related packages in one subtask
   
   - Configuration errors = HIGH (priority: 80)
     * BUT: If config error is because file is missing → it's actually priority 100
     * Example: "Cannot find index.html" → Create file (priority 100), not change config
   
   - Import/Type errors = MEDIUM (priority: 50-70)
   
   - Lint errors = LOW (priority: 20-30)
     * ESLint/Prettier code style issues
     * These are NON-BLOCKING (build still works)
     * Fix AFTER all build/deps/types are resolved
     * Group all lint errors into one subtask at the end
   
   - Other issues = LOWEST (priority: 10-19)

4. Return JSON ONLY (no explanation, no comments):
{
  "action": "create" | "update" | "keep",
  "reason": "why this action",
  "subtasks": [
    {
      "name": "Create Missing Entry Files",
      "priority": 100,
      "description": "Create index.html and main.tsx - required for Vite",
      "errors": ["Cannot resolve entry module 'index.html'", ...]
    }
  ]
}

CRITICAL RULES:
- Higher priority = more critical (100 > 90 > 80 > 50 > 20 > 10)
- Each error should be in exactly ONE subtask
- If action is "keep", subtasks can be empty array
- Focus on ROOT CAUSES, not symptoms
- Missing files → CREATE them (don't suggest config changes)
- Dependencies → Include ALL peer deps
- Lint errors → LOWEST priority (20-30), create ONE subtask for all lint issues
- Analyze WHAT BLOCKS WHAT:
  * Missing deps blocks everything (priority 90)
  * Missing files blocks build (priority 100)
  * Type errors block compilation (priority 50-70)
  * Lint errors DON'T block anything (priority 20-30)`;

  try {
    const response = await llm.invoke([{ role: 'user', content: prompt }]);
    
    // Extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log('⚠️  LLM response had no JSON, keeping current subtasks');
      return null;
    }
    
    const analysis = JSON.parse(jsonMatch[0]);
    return analysis;
  } catch (error) {
    console.error('❌ Failed to analyze subtasks:', error);
    return null;
  }
}

/**
 * Plan Node
 * Generate execution plan based on artifacts
 * NOW: LLM also manages subtasks dynamically
 */
export async function plan(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  const llm = state.deps?.llm as LLMClient;
  const engine = state.deps?.promptEngine as PromptEngine;

  // Check if this is a retry after enforcement
  // NOTE: Check enforcementReason directly, not retries, because retries can be reset by progress detection
  const enforcementReason = state.enforcementReason;
  const isRetry = Boolean(enforcementReason);
  const hasSubtask = Boolean(state.currentSubtask);
  
  if (isRetry) {
    console.log(`\n🔄 RETRY ${state.retries}/${state.maxRetries} - Re-planning after validation failure`);
    
    if (hasSubtask) {
      console.log(`🎯 Current Subtask: ${state.currentSubtask!.name} (${state.subtaskIndex}/${state.totalSubtasks})`);
      console.log(`   Category: ${state.currentSubtask!.category}`);
      console.log(`   Errors: ${state.currentSubtask!.errors.length}`);
      if (state.remainingSubtasks && state.remainingSubtasks.length > 0) {
        console.log(`   Remaining: ${state.remainingSubtasks.map(s => s.name).join(', ')}`);
      }
    }
    
    console.log(`📋 Has enforcementReason: ${!!enforcementReason}`);
    if (enforcementReason) {
      console.log(`📋 Enforcement reason: ${enforcementReason.substring(0, 150)}...\n`);
    } else {
      console.log(`⚠️  Warning: No enforcement reason provided!\n`);
    }
    
    // ===== LLM-DRIVEN SUBTASK MANAGEMENT =====
    // Let LLM decide if subtasks need to be created/updated
    if (state.violations && state.violations.length > 0) {
      console.log('🤖 Asking LLM to analyze errors and manage subtasks...\n');
      
      const analysis = await analyzeSubtasks(
        llm,
        state.violations,
        state.currentSubtask,
        state.remainingSubtasks || [],
        state.previousAttempts || []
      );
      
      if (analysis && (analysis.action === 'create' || analysis.action === 'update')) {
        console.log(`🔄 LLM decided to ${analysis.action.toUpperCase()} subtasks: ${analysis.reason}`);
        console.log(`📊 New subtasks (${analysis.subtasks.length}):`);
        
        analysis.subtasks.forEach((st: any, i: number) => {
          console.log(`   ${i + 1}. ${st.name} (priority: ${st.priority}, ${st.errors.length} errors)`);
        });
        console.log('');
        
        // Apply LLM's decision
        const newSubtasks = analysis.subtasks.map((st: any) => ({
          ...st,
          category: 'other' as any // LLM doesn't use rigid categories
        }));
        
        if (newSubtasks.length > 0) {
          const currentSubtask = newSubtasks[0];
          const remainingSubtasks = newSubtasks.slice(1);
          
          console.log(`🎯 Focusing on: ${currentSubtask.name}\n`);
          
          // Update state with new subtasks and continue to planning
          Object.assign(state, {
            currentSubtask,
            remainingSubtasks,
            subtaskIndex: 1,
            totalSubtasks: newSubtasks.length,
            retries: 0
          });
        }
      } else if (analysis?.action === 'keep') {
        console.log(`✅ LLM decided to keep current subtasks: ${analysis.reason}\n`);
      }
    }
  }

  // Prepare artifacts (using new unified names)
  const artifacts = {
    directive: state.directive,
    designDoc: state.design,         // Map to old name for PromptEngine compatibility
    prdSpec: state.prd,
    currentCode: state.code,         // Map to old name
    originalFiles: state.codeHead,   // Map to old name (git HEAD)
  };

  try {
    // Build prompt using PromptEngine
    const result = await engine.buildPlanPrompt(
      "code",
      state.context,
      artifacts,
      state.codeMode
    );

    // Invoke LLM with streaming
    let planText = '';
    
    console.log(`⏱️  Prompt build time: ${result.metadata.buildTime}ms`);
    console.log(`🎯 Inferred mode: ${result.modeConfig.mode}`);
    
    // If this is a retry, prepend validation errors to help plan better
    let promptMessages = result.formatted.messages;
    if (isRetry && enforcementReason) {
      const previousAttemptsText = formatPreviousAttempts(state.previousAttempts || []);
      
      // Include current subtask info if available
      const subtaskContext = state.currentSubtask ? `
🎯 CURRENT FOCUSED SUBTASK (${state.subtaskIndex}/${state.totalSubtasks}):
  Name: ${state.currentSubtask.name}
  Description: ${state.currentSubtask.description}
  Errors to fix: ${state.currentSubtask.errors.length}

${state.remainingSubtasks && state.remainingSubtasks.length > 0 ? 
`📋 REMAINING SUBTASKS: ${state.remainingSubtasks.map(s => s.name).join(', ')}` : 
'📋 This is the FINAL subtask'}

⚠️ FOCUS EXCLUSIVELY on the current subtask. DO NOT try to fix other issues.
` : '';
      
      const retryContext = `
🔴 PREVIOUS ATTEMPT FAILED - VALIDATION ERRORS:

${enforcementReason}
${subtaskContext}
📝 PREVIOUS ATTEMPTS HISTORY (${state.previousAttempts?.length || 0} attempts):
${previousAttemptsText}

⚠️ CRITICAL: DO NOT REPEAT THE SAME APPROACH!
Review what you tried before. If you already added a dependency but it's still missing,
you may have added it to the wrong package.json or forgot to include it.

🚫 FORBIDDEN ACTIONS (Will cause immediate failure):
1. ❌ Adding comments to JSON files (package.json, tsconfig.json)
   - JSON does NOT support // or /* */ comments
   - Comments will cause "JSON.parse" errors
   
2. ❌ Changing config to avoid missing files
   - If "Cannot find index.html" → CREATE index.html
   - DO NOT remove index.html from vite config
   - Missing files must be CREATED, not worked around
   
3. ❌ Adding only main package without peer dependencies
   - @vitejs/plugin-react requires react AND react-dom
   - Always check package documentation for peer deps
   - Add ALL related packages together

📋 INSTRUCTIONS FOR RE-PLANNING:
1. **Learn from failures**: Look at what you tried before and WHY it failed
   - If JSON parse error → You added comments to JSON (FORBIDDEN!)
   - If missing module error persists → You forgot peer dependencies
   - If missing file error → You changed config instead of creating file

2. **Identify ROOT CAUSE**: Don't just fix symptoms
   - "Cannot find index.html" → ROOT CAUSE: index.html doesn't exist
   - Solution: CREATE index.html (NOT remove from config)
   
3. **Try DIFFERENT approach**: 
   - Check PREVIOUS ATTEMPTS to see what failed
   - If you added deps but still failing → You missed peer deps
   - If you modified config but still failing → You should've created the file instead
   
4. **Be thorough and FOLLOW RULES**: 
   - JSON files → NO comments (pure JSON only)
   - Missing dependencies → Check and include ALL peer deps
   - Missing files → CREATE them immediately (highest priority)
   - Type errors → Add proper @types/* packages
   - Config errors → Fix config, but if it's about missing file → CREATE FILE!

🎯 SUCCESS CRITERIA: 
- Your new plan addresses SPECIFIC errors
- You follow ALL forbidden action rules
- You create files instead of working around them
- You include peer dependencies, not just main packages
- You output pure JSON (no comments)
`;
      
      // Add retry context to the user message
      promptMessages = result.formatted.messages.map((msg, idx) => {
        if (idx === promptMessages.length - 1 && msg.role === 'user') {
          return {
            ...msg,
            content: retryContext + '\n\n' + msg.content
          };
        }
        return msg;
      });
    }
    
    console.log('\n📝 Generating plan...\n');
    
    if (llm.stream) {
      // Use streaming if available
      for await (const chunk of llm.stream(promptMessages)) {
        process.stdout.write(chunk);
        // Force flush for real-time output
        try {
          // @ts-ignore - _handle is internal Node.js API
          if (typeof process.stdout._handle?.flush === 'function') {
            // @ts-ignore
            process.stdout._handle.flush();
          }
        } catch {
          // Ignore flush errors
        }
        planText += chunk;
      }
      console.log('\n');
    } else {
      // Fallback to regular invoke
      planText = await llm.invoke(promptMessages);
    }

    const codeMode = result.modeConfig.mode;

    console.log('\n✅ Plan generation complete');
    
    // Clear enforcementReason after using it in plan
    return { 
      ...state, 
      planText, 
      codeMode,
      enforcementReason: null  // Clear for next cycle
    };
  } catch (error) {
    console.error('❌ [Plan] Error occurred:', error);
    throw error; // Re-throw to let LangGraph handle it
  }
}
