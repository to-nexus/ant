/**
 * SendSubTab local-mode UI gating — source-level regression guard.
 *
 * Local mode has no organization → cross-user transfer is impossible
 * by definition. The "다른 사람" (other) toggle, the MemberPicker, and
 * any "other" branch in SendSubTab must be hidden behind a `!isLocalMode`
 * gate. The corresponding BE guard lives in `transfer.routes.ts`
 * (LOCAL_MODE_NO_CROSS_USER) and `org.routes.ts` (members → self only).
 *
 * This file pins the SendSubTab side of that contract. RTL render would
 * be more thorough but the GNB-driven `serverMode` involves heavy store
 * wiring; a source-level lint is enough to catch the regression where
 * someone re-introduces an unconditional "other" toggle.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

const SEND_SUB_TAB = path.resolve(
  __dirname,
  '..',
  '..',
  'src',
  'presentation',
  'components',
  'Transfer',
  'SendSubTab.tsx',
);

describe('SendSubTab — local mode UI gating', () => {
  let source: string;

  it('reads serverMode via the shared selector', () => {
    source = readFileSync(SEND_SUB_TAB, 'utf-8');
    expect(source).toMatch(/from\s+['"]@\/domain\/store\/selectors\/auth['"]/);
    expect(source).toMatch(/selectServerMode\(s\)/);
  });

  it('derives an isLocalMode flag from serverMode', () => {
    source ??= readFileSync(SEND_SUB_TAB, 'utf-8');
    expect(source).toMatch(/isLocalMode\s*=\s*serverMode\s*===\s*['"]local['"]/);
  });

  it("forces sendTarget to 'self' in local mode (overrides any persisted preference)", () => {
    source ??= readFileSync(SEND_SUB_TAB, 'utf-8');
    expect(source).toMatch(
      /sendTarget\s*=\s*isLocalMode\s*\?\s*['"]self['"]\s*:\s*storedSendTarget/,
    );
  });

  it('gates the self/other toggle block behind !isLocalMode', () => {
    source ??= readFileSync(SEND_SUB_TAB, 'utf-8');
    // The toggle row + MemberPicker must be wrapped in `{!isLocalMode && (...)}`.
    expect(source).toMatch(/\{!isLocalMode\s*&&\s*\(/);
  });

  it("does NOT render the 'others' button unconditionally", () => {
    source ??= readFileSync(SEND_SUB_TAB, 'utf-8');
    // The `t('send.others')` literal must appear inside the !isLocalMode
    // block — i.e. preceded (within the file) by the gate token. We
    // verify by string-index ordering.
    const gateIdx = source.indexOf('!isLocalMode');
    const othersIdx = source.indexOf("t('send.others')");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(othersIdx).toBeGreaterThan(gateIdx);
  });
});
