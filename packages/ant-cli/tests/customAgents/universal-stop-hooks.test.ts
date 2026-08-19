/**
 * Universal stop hooks — the deterministic turn-completion contract
 * (`core/customAgents/stopHooks.ts` SSOT + the router priority).
 *
 * Verdicts must come from observed tool evidence only (writes / successful
 * actions / the restored ledger), never from LLM claims — these tables pin
 * the predicate, the glob matcher, the ledger union (hooks met on a prior
 * paused turn are not re-demanded), and the ✓/✗ gate message split.
 */

import { describe, it, expect } from 'vitest';
import {
  UNIVERSAL_STOP_HOOK_BOUNCE_BUDGET,
  activeStopHooksOf,
  artifactGlobToRegExp,
  buildStopHookGateMessage,
  buildStopHookLedger,
  checkStopHooks,
  formatStopHookContractLines,
  formatStopHookManifest,
  hookKeyOf,
  normalizeArtifactPath,
  parseSealedHookLedger,
  verifyChecksOnDisk,
  type ActiveStopHook,
} from '../../src/core/customAgents/stopHooks';
import { routeAfterAgent } from '../../src/agents/universal/graph/nodes/agent';
import type { UniversalGraphState } from '../../src/agents/universal/graph/state';
import type { CustomIntentDef } from '@ant/shared';

const hook = (h: ActiveStopHook['hook'], intentId = 'report'): ActiveStopHook => ({ intentId, hook: h });

describe('artifactGlobToRegExp', () => {
  it.each([
    // [pattern, path, matches]
    ['reports/*-weekly.md', 'reports/2026-W34-weekly.md', true],
    ['reports/*-weekly.md', 'reports/sub/2026-W34-weekly.md', false],
    ['reports/*-weekly.md', 'reports/-weekly.md', true],
    ['reports/**/*.md', 'reports/a.md', true],
    ['reports/**/*.md', 'reports/x/y/z.md', true],
    ['reports/**/*.md', 'reports/a.txt', false],
    ['reports/**/*.md', 'other/a.md', false],
    ['reports/**', 'reports/a.md', true],
    ['reports/**', 'reports/x/y', true],
    ['reports/**', 'reports', false],
    ['*.md', 'a.md', true],
    ['*.md', 'dir/a.md', false],
    ['exact/file.md', 'exact/file.md', true],
    ['exact/file.md', 'exact/file2.md', false],
    // regex metacharacters in the pattern are literal
    ['a+b/c(1).md', 'a+b/c(1).md', true],
    ['a+b/c(1).md', 'aab/c1.md', false],
  ] as const)('%s vs %s → %s', (pattern, p, expected) => {
    expect(artifactGlobToRegExp(pattern).test(p)).toBe(expected);
  });
});

describe('normalizeArtifactPath', () => {
  it.each([
    ['./reports/a.md', 'reports/a.md'],
    ['/reports/a.md', 'reports/a.md'],
    ['reports\\a.md', 'reports/a.md'],
    ['reports/a.md', 'reports/a.md'],
  ] as const)('%s → %s', (raw, normalized) => {
    expect(normalizeArtifactPath(raw)).toBe(normalized);
  });
});

describe('activeStopHooksOf', () => {
  const catalog: CustomIntentDef[] = [
    { id: 'report', description: 'x', hooks: { stop: [{ artifact: 'reports/*.md' }, { action: 'create_file' }] } },
    { id: 'escalate', description: 'y', hooks: { stop: [{ action: 'mcp__ops-api__create_incident' }] } },
    { id: 'chat', description: 'z' },
  ];

  it('flattens the ACTIVE intents\' hooks only', () => {
    expect(activeStopHooksOf(catalog, ['report'])).toHaveLength(2);
    expect(activeStopHooksOf(catalog, ['report', 'escalate'])).toHaveLength(3);
    expect(activeStopHooksOf(catalog, ['chat'])).toEqual([]);
    expect(activeStopHooksOf(catalog, [])).toEqual([]);
  });

  it('general is reserved — never yields hooks', () => {
    expect(activeStopHooksOf(catalog, ['general'])).toEqual([]);
  });
});

describe('checkStopHooks — truth table', () => {
  it('artifact hook: met only by a matching real write', () => {
    const hooks = [hook({ artifact: 'reports/*.md' })];
    expect(checkStopHooks(hooks, { writes: ['reports/a.md'], actions: [] })[0].met).toBe(true);
    expect(checkStopHooks(hooks, { writes: ['notes/a.md'], actions: [] })[0].met).toBe(false);
    expect(checkStopHooks(hooks, { writes: [], actions: ['create_file'] })[0].met).toBe(false);
  });

  it('artifact evidence is normalized and deduplicated into matchedWrites', () => {
    const [check] = checkStopHooks([hook({ artifact: 'reports/*.md' })], {
      writes: ['./reports/a.md', 'reports/a.md', '/reports/b.md'],
      actions: [],
    });
    expect(check.matchedWrites).toEqual(['reports/a.md', 'reports/b.md']);
  });

  it('action hook: met by a successful call of that name (builtin and mcp)', () => {
    const hooks = [hook({ action: 'create_file' }), hook({ action: 'mcp__ops-api__create_incident' }, 'escalate')];
    const checks = checkStopHooks(hooks, { writes: [], actions: ['create_file'] });
    expect(checks.map((c) => c.met)).toEqual([true, false]);
    const checks2 = checkStopHooks(hooks, { writes: [], actions: ['mcp__ops-api__create_incident'] });
    expect(checks2.map((c) => c.met)).toEqual([false, true]);
  });

  it('multiple hooks within one intent AND across intents evaluate independently (AND is the caller filter)', () => {
    const hooks = [
      hook({ artifact: 'reports/*.md' }),
      hook({ action: 'mcp__slack__post-message' }),
      hook({ action: 'create_file' }, 'other'),
    ];
    const checks = checkStopHooks(hooks, { writes: ['reports/a.md'], actions: ['create_file'] });
    expect(checks.map((c) => c.met)).toEqual([true, false, true]);
    expect(checks.filter((c) => !c.met)).toHaveLength(1);
  });

  it('ledger union: hooks met on a prior paused turn are NOT re-demanded', () => {
    const hooks = [hook({ artifact: 'reports/*.md' }), hook({ action: 'mcp__slack__post-message' })];
    const priorChecks = checkStopHooks(hooks, { writes: ['reports/a.md'], actions: [] });
    const ledger = buildStopHookLedger(priorChecks);
    expect(Object.keys(ledger)).toEqual(['report#artifact:reports/*.md']);

    // Resumed turn: NO fresh writes — the artifact hook stays met via ledger.
    const resumed = checkStopHooks(hooks, { writes: [], actions: ['mcp__slack__post-message'], ledger });
    expect(resumed.map((c) => c.met)).toEqual([true, true]);
    expect(resumed[0].viaLedger).toBe(true);
  });

  it('empty hooks → empty checks', () => {
    expect(checkStopHooks([], { writes: ['a.md'], actions: ['x'] })).toEqual([]);
  });
});

describe('verifyChecksOnDisk', () => {
  it('artifact met-by-write flips to unmet when no matched file exists anymore', async () => {
    const checks = checkStopHooks([hook({ artifact: 'reports/*.md' })], { writes: ['reports/a.md'], actions: [] });
    const verified = await verifyChecksOnDisk(checks, async () => false);
    expect(verified[0].met).toBe(false);
    expect(verified[0].matchedWrites).toEqual([]);
  });

  it('surviving files keep the hook met; ledger-met checks are exempt', async () => {
    const hooks = [hook({ artifact: 'reports/*.md' })];
    const ledger = buildStopHookLedger(checkStopHooks(hooks, { writes: ['reports/prior.md'], actions: [] }));
    const checks = checkStopHooks(hooks, { writes: [], actions: [], ledger });
    // fileExists always false — the ledger verdict must survive anyway.
    const verified = await verifyChecksOnDisk(checks, async () => false);
    expect(verified[0].met).toBe(true);
  });

  it('action checks pass through untouched', async () => {
    const checks = checkStopHooks([hook({ action: 'create_file' })], { writes: [], actions: ['create_file'] });
    const verified = await verifyChecksOnDisk(checks, async () => false);
    expect(verified[0].met).toBe(true);
  });
});

describe('ledger seal round-trip', () => {
  it('hookKeyOf is stable per kind', () => {
    expect(hookKeyOf(hook({ artifact: 'reports/*.md' }))).toBe('report#artifact:reports/*.md');
    expect(hookKeyOf(hook({ action: 'create_file' }, 'escalate'))).toBe('escalate#action:create_file');
  });

  it('parseSealedHookLedger sanitizes a JSON round-trip and rejects garbage', () => {
    const ledger = { 'report#artifact:reports/*.md': { metAtTurn: true } };
    expect(parseSealedHookLedger(JSON.parse(JSON.stringify(ledger)))).toEqual(ledger);
    expect(parseSealedHookLedger(undefined)).toBeUndefined();
    expect(parseSealedHookLedger(null)).toBeUndefined();
    expect(parseSealedHookLedger([])).toBeUndefined();
    expect(parseSealedHookLedger('x')).toBeUndefined();
    expect(parseSealedHookLedger({})).toBeUndefined();
    // entries without the exact metAtTurn:true marker are dropped
    expect(parseSealedHookLedger({ a: { metAtTurn: false }, b: {}, c: null })).toBeUndefined();
    expect(parseSealedHookLedger({ a: { metAtTurn: true }, b: { metAtTurn: 'yes' } })).toEqual({
      a: { metAtTurn: true },
    });
  });
});

describe('gate message and manifest', () => {
  const checks = checkStopHooks(
    [hook({ artifact: 'reports/*.md' }), hook({ action: 'mcp__slack__post-message' }, 'escalate')],
    { writes: ['reports/a.md'], actions: [] },
  );

  it('[stop-hook] gate message splits ✓ met / ✗ unmet and carries the attempt counter', () => {
    const msg = buildStopHookGateMessage(checks, 1, UNIVERSAL_STOP_HOOK_BOUNCE_BUDGET);
    expect(msg.startsWith('[stop-hook]')).toBe(true);
    expect(msg).toContain(`attempt 1/${UNIVERSAL_STOP_HOOK_BOUNCE_BUDGET + 1}`);
    expect(msg).toContain('✓ met — [report] write a file matching `reports/*.md`');
    expect(msg).toContain('✗ unmet — [escalate] successfully call `mcp__slack__post-message`');
    expect(msg).toContain('do NOT claim completion');
  });

  it('manifest: all met → 🎯 line; unmet → ⚠️ with the patterns verbatim (author typo visible)', () => {
    const allMet = checks.map((c) => ({ ...c, met: true }));
    expect(formatStopHookManifest(allMet, 'en')).toContain('🎯');
    expect(formatStopHookManifest(allMet, 'ko')).toContain('🎯');

    const unmetManifest = formatStopHookManifest(checks, 'en')!;
    expect(unmetManifest).toContain('⚠️');
    expect(unmetManifest).toContain('`reports/*.md`');
    expect(unmetManifest).toContain('`mcp__slack__post-message`');

    expect(formatStopHookManifest([], 'en')).toBeNull();
  });

  it('prompt contract lines name the intent and the observable predicate', () => {
    const lines = formatStopHookContractLines([
      hook({ artifact: 'reports/*.md' }),
      hook({ action: 'create_file' }, 'escalate'),
    ]);
    expect(lines[0]).toContain('[report]');
    expect(lines[0]).toContain('`reports/*.md`');
    expect(lines[1]).toContain('[escalate]');
    expect(lines[1]).toContain('successfully called');
  });
});

describe('routeAfterAgent — priority with the hook redo flag', () => {
  const base = { pendingToolCalls: [] } as unknown as UniversalGraphState;

  it.each([
    ['join redo outranks hook redo', { _subagentJoinRedo: true, _hookRedo: true }, 'agent'],
    ['hook redo → agent', { _hookRedo: true }, 'agent'],
    ['hook redo outranks pending tool calls', { _hookRedo: true, pendingToolCalls: [{ id: '1', name: 'read_file', args: {} }] }, 'agent'],
    ['pending tool calls → tool', { pendingToolCalls: [{ id: '1', name: 'read_file', args: {} }] }, 'tool'],
    ['nothing → respond', {}, 'respond'],
  ] as const)('%s', (_label, patch, expected) => {
    expect(routeAfterAgent({ ...base, ...patch } as UniversalGraphState)).toBe(expected);
  });
});
