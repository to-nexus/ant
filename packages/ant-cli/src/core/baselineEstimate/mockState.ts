import type { IntentId, ResolvedActionContext, ResolvedArtifact, Mode } from '@ant/shared';
import { deriveFromIntent } from '@ant/shared';
import { loadResolvedArtifacts } from '../../agents/common/graph/loadDocumentsForRAC';

export interface BaselineMockState {
  resolvedAction: ResolvedActionContext;
  artifacts: ResolvedArtifact[];
  featurePath: string;
}

export interface BaselineMockInputs {
  intent: IntentId;
  refs: string[];
  context: string[];
  featurePath: string;
}

export function buildMockStateForIntent(inputs: BaselineMockInputs): BaselineMockState {
  const { intent, refs, context, featurePath } = inputs;
  const { mode } = deriveFromIntent(intent);
  const hasExplicit = refs.length > 0 || context.length > 0;
  const resolvedAction: ResolvedActionContext = {
    intent,
    mode: mode as Mode,
    refs,
    context,
    source: hasExplicit ? 'explicit' : 'infer',
    hasExplicitFields: hasExplicit,
  };
  const artifacts = hasExplicit ? loadResolvedArtifacts(resolvedAction, featurePath) : [];
  return { resolvedAction, artifacts, featurePath };
}
