/**
 * BUILD directive minting — the ONE place a BUILD action becomes the job's
 * `overrideDirective` (and the user turn posted alongside it).
 *
 * The two tiers sit side by side deliberately. Canonical intents are a
 * compile-time catalog, so each gets a hand-authored localized imperative
 * (`actions:buildDirective.{intentId}`). Universal intents are author data —
 * the product cannot pre-write per-intent copy — but a universal directive
 * does not need to carry the work statement: that already reaches the model
 * through the pinned intent's `prompt.md`, the job/agent `base/*.md`, and
 * `hooks.yaml`. One template stating "run this intent, no further input"
 * therefore holds for every custom intent, whatever it does.
 *
 * NEVER mint a universal directive from `CustomIntentDef.infer` — that is the
 * inference criterion rendered into the Intent Catalog every turn (`applies
 * when: …`), not a request. Using it double-injects the same prose under two
 * contradictory framings and drags the turn's locale to the author's file
 * language.
 */

import type { TFunction } from 'i18next';
import {
  INTENT_DEFINITIONS,
  getIntentDescriptionLocalized,
  normalizeIntentId,
  type Domain,
} from '@ant/shared';

// Kept in sync with `actions:universal.buildDirective` (en). Note this is only
// a last resort: i18next resolves `fallbackLng` BEFORE a defaultValue, so the
// key must exist in BOTH locale files or an English user gets the Korean copy.
const UNIVERSAL_BUILD_DIRECTIVE_EN =
  'Please run the "{{intent}}" intent. There is no further input beyond this request — treat the intent\'s own definition as the complete specification and carry it out end to end';

/**
 * Canonical (RAC pipeline) BUILD directive: authored i18n imperative →
 * catalog description → caller fallback → the button label.
 */
export function canonicalBuildDirective(args: {
  intentId: string;
  domain: Domain | undefined;
  lang: 'en' | 'ko';
  t: TFunction;
  /** Last-resort text before the button label (e.g. `Implement {specFile}`). */
  fallback?: string;
}): string {
  const { intentId, domain, lang, t, fallback } = args;
  // Persisted sessions still carry retired ids; normalize before BOTH lookups
  // or the chain collapses to the literal button label.
  const id = intentId ? normalizeIntentId(intentId) : '';
  // D28-revised — the workspace domain rides i18next `context`, so plan-related
  // directives (`gen-plan` / `explain-plan`) resolve their `_game` variant in a
  // game workspace.
  const authored = id ? t(`buildDirective.${id}`, { defaultValue: '', context: domain }) : '';
  const def = id ? INTENT_DEFINITIONS.find((d) => d.id === id) : undefined;
  return (
    authored ||
    (def ? getIntentDescriptionLocalized(def, domain, lang) : '') ||
    fallback ||
    t('footer.build')
  );
}

/** Universal (custom-agent) BUILD directive — one template, every intent. */
export function universalBuildDirective(args: { intentId: string; t: TFunction }): string {
  const { intentId, t } = args;
  return t('universal.buildDirective', {
    intent: intentId,
    defaultValue: UNIVERSAL_BUILD_DIRECTIVE_EN,
  });
}
