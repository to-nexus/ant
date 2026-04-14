/**
 * Resolve Node Types
 *
 * Common types for the unified resolve node.
 *
 * State chain: ResolvableState → TriageableState → DetectableState
 * resolve node consumes ResolvableState: loads workspace artifacts into state.
 */

import type { TokenUsage } from '../../llmHelpers.js';
import type { ActionMetadata } from '@ant/shared';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ResolvableState — base state type consumed by resolve node
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface ResolvableState {
  featurePath?: string;
  context: { featurePath?: string; project?: string; [key: string]: any };
  directive?: string;
  overrideDirective?: string;
  chatSource?: boolean;
  isResume?: boolean;

  deps?: {
    llm?: any;
    memory?: any;
    session?: any;
    workflowUpdate?: any;
    kanbanUpdate?: any;
    [key: string]: any;
  };

  _httpJobId?: string;
  tokenUsage?: TokenUsage;
  _uiLocale?: string;
  _phaseTimings?: Record<string, number>;

  actionMetadata?: ActionMetadata;
  currentAgent?: string;
  currentJob?: string;

  recursionCount?: number;
  recursionLimit?: number;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ResolveStrategy — job-specific strategy injected into createResolveNode
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface ResolveStrategy<T extends ResolvableState = ResolvableState> {
  /** Load job-specific artifacts for a new job */
  loadArtifacts(state: T): Promise<Partial<T>>;

  /** Restore job-specific state for a resumed job */
  onResume(state: T): Promise<Partial<T>>;

  /**
   * Optional: called before the activity banner for new jobs.
   * Primary use case: initialize jobTiming so the first broadcast includes it.
   * Returns state updates that get merged into the final result.
   */
  initNewJob?(state: T): Promise<Partial<T>>;
}
