/**
 * emitExecutionTier — back-channel emit of the turn's execution tier to chat.
 *
 * Sibling of `emitDetectOutcome` for jobs that have no RAC to summarize
 * (universal): the tier is packed into the canonical
 * `<executionTier>N</executionTier>` tag and rendered through
 * `SpecialTagTransformer` (Canonical Tag Rendering SSOT — see AGENTS.md).
 * Callers NEVER format the tier line themselves.
 *
 * RAC-carrying jobs surface the tier inside their `<detect>` payload via
 * `emitDetectOutcome(..., { executionTier })` — use that there, not this.
 *
 * Failures are logged (warn) so a renderer issue is always visible; chat UI
 * output remains non-blocking.
 */

import type { ExecutionTierId } from '@ant/shared';
import { SpecialTagTransformer } from './transformers/SpecialTagTransformer';
import { getChatAPIClient } from '../adapters/ChatAPIClient';
import type { UserLanguage } from '../utils/languageDetector';

export async function emitExecutionTier(
  executionTier: ExecutionTierId,
  locale: string | undefined,
): Promise<void> {
  try {
    const transformer = new SpecialTagTransformer(normalizeLocale(locale));
    const raw = `<executionTier>${executionTier}</executionTier>`;
    const result = transformer.transform(raw);

    if (!result.consumed || !result.text) {
      console.warn('[emitExecutionTier] SpecialTagTransformer did not produce text for <executionTier>');
      return;
    }

    const chatAPI = getChatAPIClient();
    await chatAPI.sendLLMEvent({ type: 'text', text: result.text });
    await chatAPI.finalizeMessage();
  } catch (err) {
    console.warn('[emitExecutionTier] failed to emit execution tier:', err);
  }
}

function normalizeLocale(locale: string | undefined): UserLanguage {
  if (locale === 'ko' || locale === 'en' || locale === 'ja' || locale === 'zh') return locale;
  return 'ko';
}
