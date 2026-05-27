/**
 * Choice System Types — pending choice card envelope.
 *
 * The detect node (or any other producer that wants to surface a choice
 * card) emits a `ChoiceEnvelope` and registers it via ChoiceService. On
 * a user pick the service returns a `ChoiceResponse` so the orchestrator
 * can route the next turn.
 */

import { ChoiceAction, ChoiceOptions } from '../../agents/common/graph/nodes/triage/types';
import type { IntentId, Mode, Domain } from '@ant/shared';

/**
 * ChoiceEnvelope — the minimum information needed to (a) surface a
 * choice card to the user and (b) route the user's pick downstream.
 * Built by detect on `blocked` / `redirect-suggested`, never by triage.
 */
export interface ChoiceEnvelope {
  resolvedIntentId?: IntentId;
  group: 'ask' | 'work';
  mode?: Mode;
  domain?: Domain;
  displayMessage?: string;
  choiceOptions?: ChoiceOptions;
  // ── Redirect target (set when choiceOptions exposes a 'redirect' action) ──
  /** Agent to switch to, derived from `switchIntentId` via the matrix. */
  suggestedAgent?: string;
  /** Job to switch to (design/code/plan/visual/learn), derived from `switchIntentId`. */
  suggestedJob?: string;
  /** Exact intent to run after the switch — passed to the target as explicit metadata. */
  switchIntentId?: IntentId;
}

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
  message?: string;          // guide/dismiss: message
  action?: ChoiceAction;     // continue: action to perform
  suggestedAgent?: string;   // redirect: target agent
  suggestedJob?: string;     // redirect: target job (design/code/plan/visual/learn)
  switchIntentId?: IntentId; // redirect: exact intent to run after switch
  directive?: string;        // redirect: original directive
}

/**
 * Pending Choice
 * 사용자 선택 대기 중인 항목
 */
export interface PendingChoice {
  jobId: string;
  projectId: string;
  featureName: string;
  envelope: ChoiceEnvelope;
  originalDirective?: string;
  createdAt: number;
  expiresAt: number;
}

/**
 * Choice Handler Interface
 */
export interface ChoiceHandler {
  handle(request: ChoiceRequest, envelope: ChoiceEnvelope): Promise<ChoiceResponse>;
}
