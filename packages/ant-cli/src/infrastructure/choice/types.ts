/**
 * Choice System Types
 * 
 * Triage 결과에 따른 사용자 선택 처리
 */

import { ChoiceAction, TriageResult } from '../../agents/common/nodes/triage/types';

/**
 * Choice Request
 */
export interface ChoiceRequest {
  jobId: string;
  projectId: string;
  featureName: string;
  choice: ChoiceAction;
}

/**
 * Choice Response
 */
export interface ChoiceResponse {
  type: 'guide' | 'continue' | 'dismiss';
  message?: string;        // guide/dismiss: message
  action?: ChoiceAction;   // continue: action to perform
  suggestedAgent?: string; // redirect: target agent
  suggestedJob?: string;   // redirect: target job
  directive?: string;      // redirect: original directive
}

/**
 * Pending Choice
 * 사용자 선택 대기 중인 항목
 */
export interface PendingChoice {
  jobId: string;
  projectId: string;
  featureName: string;
  triageResult: TriageResult;
  originalDirective?: string;  // ✅ For redirect - pass to new job
  createdAt: number;
  expiresAt: number;  // 자동 만료 시간
}

/**
 * Choice Handler Interface
 */
export interface ChoiceHandler {
  /**
   * Handle user choice
   */
  handle(request: ChoiceRequest, triageResult: TriageResult): Promise<ChoiceResponse>;
}
