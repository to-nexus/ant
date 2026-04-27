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
