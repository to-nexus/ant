/**
 * Phase 2 (D22) — chat-input mention surface invariant.
 *
 * `domain` is a workspace-scoped 1st-class selector (sticky once chosen).
 * The chat-input mention surface is turn-scoped — exposing `@domain:` there
 * would let users desync workspace state per-message and reproduce the
 * "this turn ran on the wrong domain" misdetection class. The single
 * mutation surface is `DomainToggle` on the ActionsPanel.
 *
 * Guard the regression at the source level instead of through a React
 * renderHook harness so the test is fast and config-free.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

const useMentionSrc = readFileSync(
  resolve(here, '../useMentionAutocomplete.ts'),
  'utf-8',
);
const universalSurfaceSrc = readFileSync(
  resolve(here, '../universalMentionSurface.ts'),
  'utf-8',
);
const enChat = readFileSync(
  resolve(here, '../../../../../i18n/locales/en/chat.json'),
  'utf-8',
);
const koChat = readFileSync(
  resolve(here, '../../../../../i18n/locales/ko/chat.json'),
  'utf-8',
);

describe('chat-input mention surface — `@domain:` is intentionally absent', () => {
  it('useMentionAutocomplete does not register `@domain:` as a prefix', () => {
    expect(useMentionSrc).not.toMatch(/'@domain:'/);
  });

  it('useMentionAutocomplete does not branch on the `domain` suggestion type', () => {
    // Removed alongside the prefix; presence implies a half-rewrite that
    // would silently flip the surface back on.
    expect(useMentionSrc).not.toMatch(/case '@domain:'/);
    expect(useMentionSrc).not.toMatch(/case 'domain'\s*:/);
    expect(useMentionSrc).not.toMatch(/type:\s*'domain'/);
  });

  it('chat locale files do not expose mention.domain copy', () => {
    const enJson = JSON.parse(enChat) as Record<string, unknown>;
    const koJson = JSON.parse(koChat) as Record<string, unknown>;
    const enMention = enJson.mention as Record<string, unknown> | undefined;
    const koMention = koJson.mention as Record<string, unknown> | undefined;
    expect(enMention).toBeDefined();
    expect(koMention).toBeDefined();
    expect(enMention!.domain).toBeUndefined();
    expect(koMention!.domain).toBeUndefined();
  });
});

describe('universal mention surface (D-E) — source-level invariants', () => {
  it('universal prefixes are exactly @intent:, @ctx:, @plan (no @target:/@ref:/@explicit)', () => {
    const m = universalSurfaceSrc.match(/UNIVERSAL_MENTION_PREFIXES = \[([^\]]*)\]/);
    expect(m).not.toBeNull();
    const prefixes = [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect(prefixes).toEqual(['@intent:', '@ctx:', '@plan']);
  });

  it('universal @intent: vocabulary comes from the selected job catalog (API data), not INTENT_DEFINITIONS', () => {
    // The universal branch reads `universalJobIntents` (CustomJobSummary.intents projection).
    expect(useMentionSrc).toMatch(/universalJobIntents/);
    // And the prefix command only surfaces when the job declares a catalog.
    expect(useMentionSrc).toMatch(/universalJobIntents\.length > 0/);
  });

  it('universal mentions arm universalTurnMeta (single intent slot, contexts accumulate), never actionMetadata', () => {
    expect(useMentionSrc).toMatch(/addUniversalIntentMention\(suggestion\.id\)/);
    expect(useMentionSrc).toMatch(/addUniversalContextMention\(suggestion\.id\)/);
  });

  it('universal @ctx: excludes the grafted sessions node (outside the agent sandbox)', () => {
    expect(useMentionSrc).toMatch(/isUniversalCtxSuggestible/);
  });

  it('@explicit is never settable on universal (no triage to bypass)', () => {
    expect(useMentionSrc).toMatch(/!isUniversal && canStartChat && actionMetadata\.explicit !== true/);
  });
});

describe('isUniversalCtxSuggestible — behavior rows', () => {
  it('artifacts paths suggestible; sessions subtree excluded', async () => {
    const { isUniversalCtxSuggestible } = await import('../universalMentionSurface');
    expect(isUniversalCtxSuggestible('plan/notes.md')).toBe(true);
    expect(isUniversalCtxSuggestible('briefs/a.md')).toBe(true);
    expect(isUniversalCtxSuggestible('sessions')).toBe(false);
    expect(isUniversalCtxSuggestible('sessions/chat.jsonl')).toBe(false);
    // Name-collision guard: a user dir merely PREFIXED with "sessions" stays suggestible.
    expect(isUniversalCtxSuggestible('sessions-notes/a.md')).toBe(true);
  });
});
