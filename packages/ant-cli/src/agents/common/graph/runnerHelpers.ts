/**
 * Runner Helpers — Shared utility functions for all graph runners
 *
 * Eliminates duplicated boilerplate across code/design/learn/ask/plan runners:
 * - Recursion limit parsing
 * - Error classification
 * - Chat cleanup
 * - Resume detection
 * - Graph invocation
 * - Early directive save
 */

import { getChatAPIClient } from '../../../core/adapters/ChatAPIClient';

export function loadRecursionLimit(jobTypeOrDefault?: string | number, defaultLimit = 200): number {
  // Overload: loadRecursionLimit(200) — backward-compatible numeric-only call
  if (typeof jobTypeOrDefault === 'number') {
    defaultLimit = jobTypeOrDefault;
    jobTypeOrDefault = undefined;
  }
  // Job-specific override: {JOB_TYPE}_RECURSION_LIMIT (e.g., ASK_RECURSION_LIMIT)
  if (typeof jobTypeOrDefault === 'string') {
    const jobEnv = process.env[`${jobTypeOrDefault.toUpperCase()}_RECURSION_LIMIT`] || '';
    const jobParsed = parseInt(jobEnv, 10);
    if (!isNaN(jobParsed) && jobParsed >= 5) return jobParsed;
  }
  // Global fallback
  const envVal = process.env.RECURSION_LIMIT || '';
  const parsed = parseInt(envVal, 10);
  return isNaN(parsed) || parsed < 5 ? defaultLimit : parsed;
}

export function isRecursionLimitError(error: any): boolean {
  const msg = error?.message || '';
  return msg.includes('Recursion limit') || msg.includes('recursion limit') || msg.includes('recursionLimit');
}

export async function cleanupChat(cancelled = true): Promise<void> {
  try {
    const chatAPI = getChatAPIClient();
    if (chatAPI.hasActiveMessage()) {
      await chatAPI.finalizeMessage(cancelled);
    }
  } catch { /* non-critical */ }
}

export function isEnvResume(): boolean {
  return process.env.ANT_IS_RESUME === 'true';
}

export async function logResumeMarker(featurePath: string, jobId: string): Promise<void> {
  const { getTokenLogger } = await import('../../../core/utils/tokenLogger');
  getTokenLogger({ featurePath, jobId }).logResumeMarker().catch(() => {});
}

export async function invokeGraph<T>(
  compiledGraph: { invoke(state: any, config: any): Promise<any> },
  initialState: T,
  recursionLimit: number,
): Promise<T> {
  return await compiledGraph.invoke(initialState as any, { recursionLimit }) as T;
}

/** code/design 공통: invoke 전 directive 조기 저장 */
export async function saveEarlyDirective(
  state: { deps?: any; context: any; directive?: string; overrideDirective?: string },
  jobType: string,
): Promise<void> {
  if (!state.deps?.session || !state.context.featureFolder || !state.directive) return;
  try {
    const session = await state.deps.session.load(
      state.context.project, state.context.featureFolder, jobType,
    );
    if (!session.state?.directive) {
      await state.deps.session.updateArtifacts(
        state.context.project, state.context.featureFolder, jobType,
        { state: { ...session.state, directive: state.directive, overrideDirective: state.overrideDirective, userLanguage: state.context.userLanguage } },
      );
    }
  } catch { /* non-critical */ }
}
