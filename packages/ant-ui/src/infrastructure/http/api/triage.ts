import { API_BASE, apiPost } from './client';

export type TriageChoiceAction = 'proceed' | 'proceedAnyway' | 'redirect' | 'guide';

export interface TriageChoiceResponse {
  type: 'guide' | 'continue' | 'dismiss';
  message?: string;
  action?: TriageChoiceAction;
  suggestedAgent?: string;
  suggestedJob?: string;
  directive?: string;
}

export function submitTriageChoice(
  projectId: string,
  featureName: string,
  jobId: string,
  choice: TriageChoiceAction,
): Promise<TriageChoiceResponse> {
  return apiPost(
    `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/chat/triage-choice`,
    { jobId, choice },
  );
}

export function submitEvalSave(
  projectId: string,
  featureName: string,
  evalType: string,
  content: string,
): Promise<{ success: boolean; path?: string; resolvedLabel?: string }> {
  return apiPost(
    `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/chat/eval-save`,
    { evalType, content },
  );
}

export function submitChoiceDismiss(
  projectId: string,
  featureName: string,
  contentType: string,
  choiceAction: string,
  resolvedLabel: string,
  metadataFilter?: Record<string, string>,
  extraMetadata?: Record<string, any>,
): Promise<{ success: boolean; choiceAction: string; resolvedLabel: string }> {
  return apiPost(
    `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/chat/dismiss-choice`,
    { contentType, choiceAction, resolvedLabel, metadataFilter, extraMetadata },
  );
}
