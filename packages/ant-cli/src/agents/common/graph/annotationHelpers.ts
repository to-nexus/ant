/**
 * Annotation Helpers — Shared LangGraph Annotation field definitions
 *
 * Annotation.Root spread blocks for the state chain:
 *   ResolvableFields → TriageableFields → DetectableFields
 *
 * Each graph's state.ts spreads the appropriate level and adds job-specific fields.
 * StateType<typeof XxxFields> gives the TypeScript type — no manual interface needed.
 */

import { Annotation } from '@langchain/langgraph';
import type { StateDefinition, StateType } from '@langchain/langgraph';
import type { TokenUsage } from './llmHelpers';
import type { TriageResult, WorkspaceState } from '../nodes/triage/types';
import type { ResolvedActionContext, ResolvedArtifact, ActionMetadata } from '@ant/shared';

export const ResolvableFields = {
  featurePath: Annotation<string | undefined>,
  context: Annotation<Record<string, any>>,
  directive: Annotation<string | undefined>,
  overrideDirective: Annotation<string | undefined>,
  chatSource: Annotation<boolean | undefined>,
  isResume: Annotation<boolean | undefined>,
  deps: Annotation<Record<string, any> | undefined>,
  _httpJobId: Annotation<string | undefined>,
  tokenUsage: Annotation<TokenUsage | undefined>,
  _uiLocale: Annotation<string | undefined>,
  _phaseTimings: Annotation<Record<string, number> | undefined>,
  actionMetadata: Annotation<ActionMetadata | undefined>,
  currentAgent: Annotation<string | undefined>,
  currentJob: Annotation<string | undefined>,
  recursionCount: Annotation<number | undefined>,
  recursionLimit: Annotation<number | undefined>,
} as const satisfies StateDefinition;

export const TriageableFields = {
  ...ResolvableFields,
  skipTriage: Annotation<boolean | undefined>,
  triageResult: Annotation<TriageResult | undefined>,
  workspaceState: Annotation<WorkspaceState | undefined>,
} as const satisfies StateDefinition;

export const DetectableFields = {
  ...TriageableFields,
  resolvedAction: Annotation<ResolvedActionContext | undefined>,
  resolvedArtifacts: Annotation<ResolvedArtifact[] | undefined>,
} as const satisfies StateDefinition;

export type ResolvableState = StateType<typeof ResolvableFields>;
export type TriageableState = StateType<typeof TriageableFields>;
export type DetectableState = StateType<typeof DetectableFields>;
