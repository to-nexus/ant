/**
 * Read-only fetch of one intent's `prompt.md` body for the intent detail page.
 *
 * The project-scoped catalog carries only `hasPrompt` — the body is deliberately
 * kept out of discovery (it can reach 12KB per intent, and most sessions never
 * open this page). Definitions are account/org-owned, so the account file
 * endpoint serves every agent the panel can show, readonly (org/builtin) scopes
 * included: one small request when a detail page is actually opened.
 *
 * Presence changes refresh on their own (a settings save re-syncs the catalog,
 * flipping `hasPrompt`); a content-only edit shows on the next intent switch.
 */

import { useEffect, useState } from 'react';
import { fetchDefinitionFile } from '@/infrastructure/http/api/accountAgents';

export interface IntentPromptBody {
  status: 'absent' | 'loading' | 'ready' | 'error';
  body: string;
}

export function useIntentPromptBody(
  agentId: string | null,
  jobId: string | null,
  intentId: string,
  hasPrompt: boolean | undefined,
): IntentPromptBody {
  const [state, setState] = useState<IntentPromptBody>({ status: 'absent', body: '' });

  useEffect(() => {
    if (hasPrompt !== true || !agentId || !jobId) {
      setState({ status: 'absent', body: '' });
      return;
    }
    setState({ status: 'loading', body: '' });
    let cancelled = false;
    fetchDefinitionFile(agentId, `jobs/${jobId}/intents/${intentId}/prompt.md`)
      .then(({ content }) => {
        if (!cancelled) setState({ status: 'ready', body: content });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', body: '' });
      });
    return () => {
      cancelled = true;
    };
  }, [agentId, jobId, intentId, hasPrompt]);

  return state;
}
