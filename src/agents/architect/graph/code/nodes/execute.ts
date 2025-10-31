import { LLMClient } from "../../../../../core/ports";
import { ArchitectGraphState, AttemptHistory, Violation } from "../state";
import { parseResponse } from "./parseResponse";
import { PromptEngine } from "../../../../../core/prompt/engine";

/**
 * Extract key changes from generated files
 * Focus on package.json changes and new file types
 */
function extractKeyChanges(files: Array<{ path: string; content: string }>): string[] {
  const changes: string[] = [];
  
  for (const file of files) {
    // Package.json changes - very important!
    if (file.path.includes('package.json')) {
      try {
        const pkg = JSON.parse(file.content);
        
        if (pkg.dependencies) {
          const deps = Object.keys(pkg.dependencies);
          if (deps.length > 0) {
            changes.push(`Added dependencies: ${deps.join(', ')}`);
          }
        }
        
        if (pkg.devDependencies) {
          const devDeps = Object.keys(pkg.devDependencies);
          if (devDeps.length > 0) {
            changes.push(`Added devDependencies: ${devDeps.join(', ')}`);
          }
        }
      } catch {
        changes.push('Modified package.json');
      }
    }
    
    // Config files
    else if (file.path.includes('tsconfig.json')) {
      changes.push('Created/modified tsconfig.json');
    }
    else if (file.path.includes('vite.config')) {
      changes.push('Created/modified vite.config');
    }
    else if (file.path.endsWith('.html')) {
      changes.push(`Created HTML entry: ${file.path}`);
    }
    // Component/source files
    else if (file.path.match(/\.(tsx?|jsx?)$/)) {
      changes.push(`Created component: ${file.path}`);
    }
  }
  
  return changes;
}

/**
 * Execute node - generates code using LLM
 * Can be used for initial generation or enforcement (with reasonHeader)
 */
export async function execute(
  state: ArchitectGraphState
): Promise<ArchitectGraphState> {
  try {
    const llm = state.deps?.llm as LLMClient;
    const engine = state.deps?.promptEngine as PromptEngine;
  
  // Prepare artifacts (using new unified names)
  const artifacts = {
    directive: state.directive,
    designDoc: state.design,         // Map to old name
    prdSpec: state.prd,
    currentCode: state.code,         // Map to old name
    originalFiles: state.codeHead,   // Map to old name
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
  
  console.log(`⏱️  Prompt build time: ${buildResult.metadata.buildTime}ms`);

  // ===== ADD RETRY CONTEXT IF THIS IS A RETRY =====
  let promptMessages = formatted.messages;
  const isRetry = Boolean(state.enforcementReason);
  
  if (isRetry && state.enforcementReason) {
    console.log('⚠️  Adding retry context with error feedback...\n');
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
    
    const retryContext = `
🔴 PREVIOUS ATTEMPT FAILED - FIX THESE ERRORS:

${state.enforcementReason}

📝 PREVIOUS ATTEMPTS (${state.previousAttempts?.length || 0} attempts):
${previousAttemptsText}

⚠️ CRITICAL INSTRUCTIONS:
1. READ THE ERRORS ABOVE CAREFULLY
2. DO NOT REPEAT THE SAME APPROACH
3. GENERATE ALL REQUIRED FILES (including any missing files mentioned in errors)
4. If error says "Cannot resolve entry index.html" → CREATE index.html in root
5. If error says "Module not found" → CREATE the missing file or install the package

📋 NOW GENERATE THE CODE WITH ALL REQUIRED FILES:
`;
    
    // Add retry context to the last user message
    promptMessages = formatted.messages.map((msg, idx) => {
      if (idx === formatted.messages.length - 1 && msg.role === 'user') {
        return {
          ...msg,
          content: retryContext + '\n\n' + msg.content
        };
      }
      return msg;
    });
  }

  // Generate code with streaming
  let raw = '';
  
  console.log('\n💻 Generating code...\n');
  
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
      raw += chunk;
    }
    console.log('\n');
  } else {
    // Fallback to regular invoke
    raw = await llm.invoke(promptMessages);
  }
  
    const { responseSection, files, filesToDelete } = parseResponse(raw);

    // Record this attempt for learning
    const filesGenerated = files.map(f => f.path);
    const keyChanges = extractKeyChanges(files);
    
    const currentAttempt: AttemptHistory = {
      attemptNumber: (state.previousAttempts?.length || 0) + 1,
      filesGenerated,
      keyChanges,
      subtaskName: state.currentTask?.name,
      // Use lastViolations (from previous attempt) not current violations (not set yet)
      errorsAttemptedToFix: state.currentTask?.errors || 
        (state.lastViolations?.map(v => v.message) || [])
    };
    
    // Add to history
    const previousAttempts = [...(state.previousAttempts || []), currentAttempt];
    
    console.log(`\n📝 Attempt #${currentAttempt.attemptNumber} recorded:`);
    console.log(`   Files: ${filesGenerated.length}`);
    console.log(`   Changes: ${keyChanges.length}`);
    if (keyChanges.length > 0) {
      keyChanges.forEach(change => console.log(`      - ${change}`));
    }

    return {
      ...state,
      rawResponse: raw,
      responseSection,
      files,
      filesToDelete,
      previousAttempts
    };
  } catch (error) {
    console.error('\n❌ ═══════════════════════════════════════════════════════════════');
    console.error('❌ [Execute] CRITICAL ERROR - LLM API CALL FAILED');
    console.error('❌ ═══════════════════════════════════════════════════════════════\n');
    
    // Extract detailed error information
    let errorType = 'unknown';
    let errorMessage = 'Unknown error';
    let suggestedFix = 'Check LLM configuration and connection';
    let isRetryable = true;
    
    // Check if it's an API error with structured format
    if (error && typeof error === 'object') {
      const apiError = error as any;
      
      // Anthropic API error format: { type: "error", error: { type: "...", message: "..." } }
      if (apiError.error?.type) {
        errorType = apiError.error.type;
        errorMessage = apiError.error.message || errorMessage;
        
        switch (apiError.error.type) {
          case 'rate_limit_error':
            console.error('🚨 ERROR TYPE: RATE LIMIT EXCEEDED');
            console.error('📊 You have exceeded the API rate limit');
            console.error('⏰ Please wait a few moments and try again\n');
            suggestedFix = 'Wait 1-2 minutes and re-run the task. The agent will resume from the last checkpoint.';
            isRetryable = false; // User needs to wait
            break;
            
          case 'overloaded':
            console.error('🚨 ERROR TYPE: API OVERLOADED');
            console.error('⚡ The API service is currently overloaded');
            console.error('⏰ Please wait and try again\n');
            suggestedFix = 'Wait 30-60 seconds and re-run the task. The agent will resume from the last checkpoint.';
            isRetryable = false; // User needs to wait
            break;
            
          case 'insufficient_quota':
          case 'insufficient_funds':
            console.error('🚨 ERROR TYPE: INSUFFICIENT API QUOTA/CREDITS');
            console.error('💳 Your API account has insufficient credits');
            console.error('🔗 Please add credits to your API account\n');
            suggestedFix = 'Add credits to your Anthropic API account and re-run the task.';
            isRetryable = false; // User needs to add credits
            break;
            
          case 'invalid_api_key':
          case 'authentication_error':
            console.error('🚨 ERROR TYPE: AUTHENTICATION FAILED');
            console.error('🔑 API key is invalid or missing');
            console.error('⚙️  Please check your ANTHROPIC_API_KEY environment variable\n');
            suggestedFix = 'Set valid ANTHROPIC_API_KEY in your environment and re-run.';
            isRetryable = false; // User needs to fix API key
            break;
            
          case 'api_error':
          default:
            console.error('🚨 ERROR TYPE: API ERROR');
            console.error(`📝 Message: ${errorMessage}\n`);
            suggestedFix = 'Check API status and try again. The agent will resume from the last checkpoint.';
            isRetryable = false;
            break;
        }
      } else if (error instanceof Error) {
        errorMessage = error.message;
        console.error('🚨 ERROR TYPE: EXECUTION ERROR');
        console.error(`📝 Message: ${errorMessage}\n`);
        
        // Check for common network errors
        if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('ETIMEDOUT')) {
          console.error('🌐 Network connection issue detected');
          suggestedFix = 'Check your internet connection and API endpoint availability.';
          isRetryable = false;
        } else if (errorMessage.includes('timeout')) {
          console.error('⏰ Request timeout detected');
          suggestedFix = 'The request took too long. Try again or check API service status.';
          isRetryable = false;
        }
      }
    }
    
    console.error('❌ Full error details:', JSON.stringify(error, null, 2));
    console.error('❌ ═══════════════════════════════════════════════════════════════\n');
    
    // Return state with empty files to trigger validation failure
    const executeError: Violation = {
      type: 'other',
      severity: 'critical',
      message: `LLM API Error [${errorType}]: ${errorMessage}`,
      suggestedFix,
      isRetryable
    };
    
    return {
      ...state,
      files: [],
      filesToDelete: [],
      violations: [...(state.violations || []), executeError]
    };
  }
}

