/**
 * Mock triage LLM response — Phase B v2.
 *
 * Triage LLM emits a single `<intentId>` tag. The default mock response
 * picks `gen-code-spec` since most legacy mocks stand in for the
 * "produce code from spec" happy path; tests that need a different intent
 * can call `triageResponseWithIntent(id)`.
 */

import type { IntentId } from '@ant/shared';

export function triageResponse(): string {
  return triageResponseWithIntent('gen-code-spec' as IntentId);
}

export function triageResponseWithIntent(intentId: IntentId): string {
  return `<intentId>${intentId}</intentId>`;
}
