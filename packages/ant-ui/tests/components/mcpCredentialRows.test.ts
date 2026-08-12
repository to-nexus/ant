/**
 * Credential panel row derivation — the union that keeps registered-but-
 * unreferenced keys visible (and deletable) instead of orphaning them the
 * moment the last `${secret:…}` binding is removed, plus the strict
 * reference parse that decides which values spawn rows at all.
 */

import { describe, it, expect, vi } from 'vitest';
import { parseSecretRef, formatSecretRef } from '@ant/shared';

vi.mock('../../src/infrastructure/http/api/accountAgents', () => ({
  fetchMcpCredentials: vi.fn(async () => ({ credentials: [] })),
  saveMcpCredential: vi.fn(),
  deleteMcpCredential: vi.fn(),
}));

import { credentialPanelRows } from '../../src/presentation/components/AgentSettings/overview/McpServersEditor';

describe('credentialPanelRows — union of referenced and registered keys', () => {
  it.each([
    [
      'referenced only',
      ['A_KEY'],
      {},
      1,
      [{ key: 'A_KEY', referenced: true, registered: false }],
    ],
    [
      'registered only (orphan stays visible)',
      [],
      { ORPHAN: '2026-08-01T00:00:00Z' },
      1,
      [{ key: 'ORPHAN', referenced: false, registered: true }],
    ],
    [
      'referenced and registered',
      ['A_KEY'],
      { A_KEY: '2026-08-01T00:00:00Z' },
      1,
      [{ key: 'A_KEY', referenced: true, registered: true }],
    ],
    [
      'union is sorted and de-duplicated',
      ['B_KEY', 'A_KEY'],
      { B_KEY: 'x', C_KEY: 'y' },
      1,
      [
        { key: 'A_KEY', referenced: true, registered: false },
        { key: 'B_KEY', referenced: true, registered: true },
        { key: 'C_KEY', referenced: false, registered: true },
      ],
    ],
    ['empty inputs produce no rows', [], {}, 1, []],
    // Account-scoped registry vs definition-scoped editor: a definition that
    // declares no server has no credential surface at all.
    [
      'no declared server hides account-registered keys',
      [],
      { ORPHAN: 'x', OTHER: 'y' },
      0,
      [],
    ],
  ])('%s', (_label, referenced, registeredAt, declaredServerCount, expected) => {
    expect(
      credentialPanelRows(
        referenced as string[],
        registeredAt as Record<string, string>,
        declaredServerCount as number,
      ),
    ).toEqual(expected);
  });
});

describe('parseSecretRef — only the explicit marker is a credential reference', () => {
  it.each([
    ['${secret:GITHUB_TOKEN}', 'GITHUB_TOKEN'],
    ['${secret:A}', 'A'],
    ['GITHUB_TOKEN', null], // bare legacy form is NOT a reference
    ['Bearer abc', null],
    ['${secret:not-caps}', null], // malformed key
    ['${secret:}', null],
    ['ws-abc-123', null],
    ['', null],
  ])('%s → %s', (value, expected) => {
    expect(parseSecretRef(value)).toBe(expected);
  });

  it('formatSecretRef round-trips through parseSecretRef', () => {
    expect(parseSecretRef(formatSecretRef('OPS_TOKEN'))).toBe('OPS_TOKEN');
  });
});
