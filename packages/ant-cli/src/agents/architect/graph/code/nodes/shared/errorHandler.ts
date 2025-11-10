/**
 * Error Handler - Common error handling logic
 */

import { Violation } from "../../state";

export interface ErrorDetails {
  type: string;
  message: string;
  suggestedFix: string;
  isRetryable: boolean;
}

/**
 * Extract error details from LLM API error
 */
export function extractErrorDetails(error: unknown): ErrorDetails {
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
    } else if (apiError.message) {
      // Generic error object
      errorMessage = apiError.message;
      errorType = apiError.name || 'Error';
    }
  } else if (error instanceof Error) {
    errorMessage = error.message;
    errorType = error.name;
  }
  
  console.error(`\n📋 ERROR DETAILS:`);
  console.error(`   Type: ${errorType}`);
  console.error(`   Message: ${errorMessage}`);
  console.error(`   Suggested Fix: ${suggestedFix}`);
  console.error(`   Retryable: ${isRetryable}\n`);
  
  return {
    type: errorType,
    message: errorMessage,
    suggestedFix,
    isRetryable
  };
}

/**
 * Create violation from error details
 */
export function createErrorViolation(errorDetails: ErrorDetails): Violation {
  return {
    type: 'other',
    severity: 'critical',
    message: `LLM API Error [${errorDetails.type}]: ${errorDetails.message}`,
    suggestedFix: errorDetails.suggestedFix,
    isRetryable: errorDetails.isRetryable
  };
}

/**
 * Log error header
 */
export function logErrorHeader(context: string): void {
  console.error('\n❌ ═══════════════════════════════════════════════════════════════');
  console.error(`❌ [${context}] CRITICAL ERROR - LLM API CALL FAILED`);
  console.error('❌ ═══════════════════════════════════════════════════════════════\n');
}

