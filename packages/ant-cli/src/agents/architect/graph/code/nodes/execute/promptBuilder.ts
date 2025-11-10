/**
 * Prompt Builder for Execute Node
 * 
 * Builds context-aware prompts with retry and scope limiting
 */

import { ArchitectGraphState } from "../../state";
import { buildRetryContext } from "../shared/retryContext";
import { buildPlanContract } from "./planContract";
import { PromptEngine } from "../../../../../../core/prompt/engine";

export interface PromptMessages {
  messages: Array<{ role: string; content: string }>;
}

/**
 * Build execute prompt with artifacts and context
 */
export async function buildExecutePromptMessages(
  state: ArchitectGraphState,
  engine: PromptEngine
): Promise<PromptMessages> {
  // Prepare artifacts (using new unified names)
  const artifacts = {
    directive: state.directive,
    designDoc: state.design,         // Map to old name
    prdSpec: state.prd,
    currentCode: state.code,         // Map to old name
    originalFiles: state.codeHead,   // Map to old name
    currentTask: state.currentTask ? {  // ✅ Pass current task info (with timing)
      name: state.currentTask.name,
      type: state.currentTask.type,
      description: state.currentTask.description
    } : undefined,
    // ✅ NEW: Retry context for template injection
    retryContext: buildRetryContext(state),
    // ✅ NEW: Plan contract for preservation
    planContract: buildPlanContract(state)
  };
  
  // Build prompt using PromptEngine with taskType
  const buildResult = await engine.buildExecutePrompt(
    "code",
    state.context,
    artifacts,
    state.planText,
    state.codeMode,
    state.currentTask?.type  // Pass taskType for language-specific constraints
  );
  
  const formatted = buildResult.formatted;
  
  // Add retry or scope-limiting context if needed
  let promptMessages = formatted.messages;
  const isRetry = Boolean(state.enforcementReason);
  
  if (isRetry && state.enforcementReason) {
    promptMessages = addRetryContext(state, formatted.messages) as any;
  } else if (state.completedTasksDetails && state.completedTasksDetails.length > 0) {
    promptMessages = addScopeLimitingContext(state, formatted.messages) as any;
  }
  
  return { messages: promptMessages };
}

/**
 * Add retry context with error feedback
 */
function addRetryContext(
  state: ArchitectGraphState,
  messages: Array<{ role: string; content: string }>
): Array<{ role: string; content: string }> {
  console.log('⚠️  Adding retry context with error feedback...\n');
  
  // ✅ 이미 시도한 작업들을 명확히 정리
  const alreadyAppliedChanges: string[] = [];
  const alreadyCreatedFiles: Set<string> = new Set();
  
  state.previousAttempts?.forEach(attempt => {
    attempt.keyChanges.forEach(change => {
      if (!alreadyAppliedChanges.includes(change)) {
        alreadyAppliedChanges.push(change);
      }
    });
    attempt.filesGenerated.forEach(file => {
      alreadyCreatedFiles.add(file);
    });
  });
  
  // Format previous attempts
  const previousAttemptsText = state.previousAttempts?.map(attempt => {
    const lines = [`\n### Attempt #${attempt.attemptNumber}`];
    if (attempt.keyChanges.length > 0) {
      lines.push('**Changes:** ' + attempt.keyChanges.join(', '));
    }
    if (attempt.filesGenerated.length > 0) {
      lines.push('**Files:** ' + attempt.filesGenerated.join(', '));
    }
    if (attempt.errorsAttemptedToFix && attempt.errorsAttemptedToFix.length > 0) {
      lines.push('**❌ ERRORS:**');
      attempt.errorsAttemptedToFix.slice(0, 3).forEach(err => lines.push(`  - ${err}`));
    }
    return lines.join('\n');
  }).join('\n') || 'No previous attempts.';
  
  // ✅ Check if this is an environment error that requires terminal commands
  const hasEnvironmentError = state.enforcementReason?.toLowerCase().includes('environment') ||
                               state.enforcementReason?.toLowerCase().includes('corrupted') ||
                               state.enforcementReason?.toLowerCase().includes('npm install') ||
                               state.enforcementReason?.toLowerCase().includes('clean dependency');
  
  const retryContext = `
🔴 PREVIOUS ATTEMPT FAILED - FIX THESE ERRORS:

${state.enforcementReason}

${hasEnvironmentError ? `
⚡ **CRITICAL: YOU CAN EXECUTE TERMINAL COMMANDS!**

The error above requires running terminal commands. You HAVE THE ABILITY to execute them directly.

**DO NOT say "I cannot execute commands" or "User needs to run"**

**EXECUTE THESE COMMANDS NOW:**
1. Navigate to the project directory
2. Run the commands listed in the error message above
3. After successful execution, continue with your task

Example:
\`\`\`bash
cd /path/to/project
rm -rf node_modules package-lock.json
npm cache clean --force
npm install
npm run build
\`\`\`

✅ You MUST execute these commands as part of your response.
✅ After commands succeed, generate any code files if needed.
❌ DO NOT just suggest - EXECUTE the commands!

` : ''}
📝 PREVIOUS ATTEMPTS (${state.previousAttempts?.length || 0} attempts):
${previousAttemptsText}

⚠️ ALREADY APPLIED (DO NOT REPEAT THESE):
${alreadyAppliedChanges.length > 0 ? alreadyAppliedChanges.map(c => `  ✓ ${c}`).join('\n') : '  (None)'}

📂 FILES ALREADY CREATED/MODIFIED:
${alreadyCreatedFiles.size > 0 ? Array.from(alreadyCreatedFiles).map(f => `  ✓ ${f}`).join('\n') : '  (None)'}

⚠️ CRITICAL INSTRUCTIONS FOR RETRY:
1. READ THE ERRORS ABOVE CAREFULLY - each error tells you EXACTLY what to fix
2. DO NOT REPEAT THE SAME APPROACH OR CHANGES LISTED ABOVE
3. ${hasEnvironmentError ? '**IF ENVIRONMENT ERROR: EXECUTE THE TERMINAL COMMANDS FIRST**' : '**ONLY OUTPUT FILES THAT NEED TO BE FIXED OR ADDED**'}
   - If error is in package.json BUT it's already modified → Try a DIFFERENT fix
   - If error is in specific .ts file → Only output that .ts file with the fix
   - If missing file → Only output the missing file
4. DO NOT RE-GENERATE FILES THAT ARE WORKING CORRECTLY
5. DO NOT RE-APPLY CHANGES ALREADY LISTED IN "ALREADY APPLIED" SECTION
6. For type errors: Follow the error message literally - it tells you exactly what to do
${hasEnvironmentError ? '7. **FOR ENVIRONMENT ERRORS: Execute commands in RESPONSE section, then output any needed files**' : ''}

📋 OUTPUT FORMAT:
${hasEnvironmentError ? `- **RESPONSE**: Execute the terminal commands shown in the error message
- **FILES**: Output code files ONLY if needed after commands succeed
` : `- **MINIMAL APPROACH**: Only output files that directly fix the errors above
- **PRECISE FIXES**: Fix the exact issue mentioned in the error (add missing property, remove unused variable, etc.)
- **NO REDUNDANCY**: Do not include files that were generated correctly in previous attempts
- **NEW STRATEGY**: Try a different approach than what was already attempted
- **FOCUS**: Fix the specific violations with fresh thinking
`}

📋 NOW ${hasEnvironmentError ? 'EXECUTE THE COMMANDS AND' : ''} GENERATE ONLY THE FILES NEEDED TO FIX THE ERRORS (WITH NEW APPROACH):
`;
  
  // Add retry context to the last user message
  return messages.map((msg, idx) => {
    if (idx === messages.length - 1 && msg.role === 'user') {
      return {
        ...msg,
        content: retryContext + '\n\n' + msg.content
      };
    }
    return msg;
  });
}

/**
 * Add scope-limiting context for subtasks
 */
function addScopeLimitingContext(
  state: ArchitectGraphState,
  messages: Array<{ role: string; content: string }>
): Array<{ role: string; content: string }> {
  const completedTaskCount = state.completedTasksDetails!.length;
  const currentTaskName = state.currentTask?.name || 'Current Task';
  const currentTaskDesc = state.currentTask?.description || '';
  
  console.log(`📋 Adding scope-limiting context (${completedTaskCount} tasks already completed)...\n`);
  
  // Show previously completed tasks for context
  const completedTasksList = state.completedTasksDetails!
    .slice(-5)  // Show last 5 completed tasks
    .map(t => `  ✅ ${t.name}`)
    .join('\n');
  
  const scopeLimitingContext = `
🎯 TASK EXECUTION CONTEXT:
You are working on a ${state.totalSubtasks && state.totalSubtasks > 1 ? 'MULTI-TASK PROJECT' : 'project'} where work is divided into separate, focused tasks.

📊 PROJECT PROGRESS:
- Total tasks: ${state.totalSubtasks || 'N/A'}
- Completed: ${completedTaskCount}
- Current task: "${currentTaskName}"

${completedTaskCount > 0 ? `📝 RECENTLY COMPLETED TASKS:\n${completedTasksList}\n` : ''}

⚠️ CRITICAL: TASK SCOPE LIMITATION
1. **YOUR CURRENT TASK**: "${currentTaskName}"
   ${currentTaskDesc ? `   Description: ${currentTaskDesc}` : ''}
   
2. **FOCUS ONLY ON THIS TASK**
   - Other tasks have already handled their responsibilities
   - Do NOT regenerate files from completed tasks
   - Do NOT duplicate work that was already done
   
3. **MINIMAL OUTPUT RULE**
   - Only generate files that are DIRECTLY REQUIRED for your current task
   - If your task is about routing → Only output routing-related files
   - If your task is about styling → Only output CSS/style files
   - If your task is about a specific feature → Only output files for that feature
   
4. **COMMON FILES TO AVOID REGENERATING**
   - package.json (unless your task explicitly requires dependency changes)
   - tsconfig.json, vite.config.ts (unless your task is about build configuration)
   - README.md (unless your task is about documentation)
   - index.html (unless your task is about the HTML entry point)
   - Core application files (App.tsx, main.tsx) unless they are the focus of your task

5. **WHEN TO MODIFY EXISTING FILES**
   Only modify an existing file if:
   - Your task description explicitly mentions that file
   - The file is directly related to your task scope
   - You need to integrate your new code with existing code

📋 GENERATE ONLY THE FILES REQUIRED FOR YOUR CURRENT TASK:
`;
  
  // Add scope-limiting context to the last user message
  return messages.map((msg, idx) => {
    if (idx === messages.length - 1 && msg.role === 'user') {
      return {
        ...msg,
        content: scopeLimitingContext + '\n\n' + msg.content
      };
    }
    return msg;
  });
}

