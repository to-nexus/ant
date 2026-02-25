/**
 * Triage Response Parser
 * 
 * LLM 응답에서 <triage>...</triage> 블록을 파싱
 */

import { TriageResult, ChoiceOptions } from './types';

/**
 * Parse triage response from LLM output
 * @param llmOutput - Raw LLM output containing <triage> block
 * @param currentJob - Current job type (for redirect detection)
 */
export function parseTriageResponse(llmOutput: string, currentJob?: string, currentAgent?: string): TriageResult | null {
  // Extract <triage>...</triage> block
  const triageMatch = llmOutput.match(/<triage>([\s\S]*?)<\/triage>/);
  if (!triageMatch) {
    console.warn('[TriageParser] No <triage> block found in response');
    return null;
  }
  
  const triageContent = triageMatch[1].trim();
  
  try {
    // Parse JSON
    const parsed = JSON.parse(triageContent);
    
    // Validate required fields
    if (!parsed.intent) {
      console.warn('[TriageParser] Missing required field: intent');
      return null;
    }
    
    // Build TriageResult
    const result: TriageResult = {
      intent: parsed.intent
    };
    
    // ask-specific fields
    if (result.intent === 'ask') {
      result.inScope = parsed.inScope;
      result.askResponse = parsed.askResponse;
    }
    
    // work-specific fields
    if (result.intent === 'work') {
      result.workStatus = parsed.workStatus;
      
      const effectiveCurrentJob = currentJob || 'unknown';
      const effectiveCurrentAgent = currentAgent || 'architect';
      
      // M1: redirect-to-same hallucination guard.
      // LLM sometimes hallucinates a redirect to the current job (e.g., code→code).
      const isRedirectToSame = 
        parsed.workStatus === 'redirect' &&
        (!parsed.suggestedJob || parsed.suggestedJob === effectiveCurrentJob) &&
        (!parsed.suggestedAgent || parsed.suggestedAgent === effectiveCurrentAgent);
      
      if (isRedirectToSame) {
        console.log(`[TriageParser] Redirect-to-same detected (${parsed.suggestedJob}→${effectiveCurrentJob}), converting to proceed`);
        result.workStatus = 'proceed';
      }
      
      // Redirect detection — uniform across ALL boundaries.
      // Three triggers (applied symmetrically, no guarded boundary exceptions):
      //   1. LLM explicitly set workStatus='redirect'
      //   2. LLM set proceed but leaked suggestedJob mismatch + redirectReason (confusion state)
      //   3. LLM set proceed but leaked suggestedAgent mismatch (cross-agent confusion)
      // For design↔plan, the prompt instructs LLM to omit suggestedJob/suggestedAgent
      // entirely when the boundary applies, so triggers 2/3 should not fire on that boundary.
      const shouldRedirect = 
        !isRedirectToSame && (
          parsed.workStatus === 'redirect' ||
          (parsed.suggestedJob && 
           parsed.suggestedJob !== effectiveCurrentJob && 
           parsed.redirectReason) ||
          (parsed.suggestedAgent && parsed.suggestedAgent !== effectiveCurrentAgent)
        );
      
      if (shouldRedirect) {
        result.workStatus = 'redirect';
        result.suggestedAgent = parsed.suggestedAgent;
        result.suggestedJob = parsed.suggestedJob;
        result.redirectReason = parsed.redirectReason;
        result.needsChoice = true;
        result.choiceOptions = buildRedirectChoice(parsed, effectiveCurrentJob);
        console.log(`[TriageParser] Redirect: suggestedAgent=${parsed.suggestedAgent || 'same'}, suggestedJob=${parsed.suggestedJob}, currentJob=${effectiveCurrentJob}`);
      }
      
      // blocked
      if (parsed.workStatus === 'blocked') {
        result.missingPrerequisites = parsed.missingPrerequisites;
        result.blockedMessage = parsed.blockedMessage;
        result.proceedAnywayOption = parsed.proceedAnywayOption;
        
        // ✅ If proceedAnywayOption exists, user CAN proceed (with warning)
        // LLM sometimes sets canProceed:false but provides proceedAnywayOption
        result.canProceed = parsed.canProceed ?? !!parsed.proceedAnywayOption;
        
        if (result.canProceed || result.proceedAnywayOption) {
          result.needsChoice = true;
          result.choiceOptions = buildBlockedChoice(parsed);
        }
      }
    }
    
    // Build display message
    result.displayMessage = buildDisplayMessage(result, parsed);
    
    return result;
  } catch (error) {
    console.error('[TriageParser] Failed to parse triage JSON:', error);
    console.error('[TriageParser] Raw content:', triageContent);
    return null;
  }
}

/**
 * Build choice options for redirect case
 * 
 * NOTE: For redirect, the negative choice should be "Dismiss" (cancel),
 * not "Continue with current job" - since it's already been determined
 * that the current job is incorrect for this task.
 */
function buildRedirectChoice(parsed: any, currentJob?: string): ChoiceOptions {
  const isSpecSuggestion = currentJob === 'code' && parsed.suggestedJob === 'design';

  return {
    positive: {
      label: isSpecSuggestion ? 'spec부터 짜기' : '전환',
      action: 'redirect'
    },
    neutral: {
      label: isSpecSuggestion ? '바로 개발' : '현재 모드로 진행',
      action: 'proceed'
    },
    negative: {
      label: isSpecSuggestion ? '취소' : 'Dismiss',
      action: 'dismiss'
    }
  };
}

/**
 * Build choice options for blocked (canProceed=true) case
 */
function buildBlockedChoice(parsed: any): ChoiceOptions {
  return {
    positive: {
      label: 'Proceed Anyway',
      action: 'proceedAnyway'
    },
    negative: {
      label: 'Dismiss',
      action: 'dismiss'
    }
  };
}

/**
 * Build display message
 */
function buildDisplayMessage(result: TriageResult, parsed: any): string {
  // ask intent - use LLM's askResponse (LLM responds in user's language)
  if (result.intent === 'ask') {
    return result.askResponse || '';
  }
  
  // work - proceed
  if (result.workStatus === 'proceed') {
    return '작업을 시작합니다.';
  }
  
  // work - redirect
  if (result.workStatus === 'redirect') {
    const agentPart = result.suggestedAgent ? `**${result.suggestedAgent}** agent / ` : '';
    return `${result.redirectReason || 'A different agent/job is more suitable.'}\n\n${agentPart}**${result.suggestedJob}** job으로 전환하시겠습니까?`;
  }
  
  // work - blocked
  if (result.workStatus === 'blocked') {
    if (result.canProceed) {
      return `${result.blockedMessage || '일부 조건이 충족되지 않았습니다.'}\n\n그래도 진행하시겠습니까?`;
    }
    return result.blockedMessage || '필수 조건이 충족되지 않았습니다.';
  }
  
  return '처리 중...';
}

/**
 * Extract raw JSON from triage response (for debugging)
 */
export function extractTriageJson(llmOutput: string): string | null {
  const triageMatch = llmOutput.match(/<triage>([\s\S]*?)<\/triage>/);
  return triageMatch ? triageMatch[1].trim() : null;
}
