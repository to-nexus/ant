/**
 * Action-hook value model — the raw ⇄ picker projection and the H7/H8
 * satisfiability-hint predicates the hook editor renders (warnings only; the
 * BE loader stays the authority).
 */

import { describe, it, expect } from 'vitest';
import { MCP_ACTION_PATTERN } from '@ant/shared';
import {
  actionHint,
  composeMcpAction,
  jobLacksArtifactWriter,
  parseActionValue,
} from '../../src/presentation/components/AgentSettings/overview/actionHook';

const BUILTINS = ['read_file', 'create_file'];
const PRESET = ['read_file', 'create_file', 'run_command', 'http_request'];
const SERVERS = ['ops-api'];

describe('parseActionValue (raw → picker projection)', () => {
  it.each([
    ['create_file', { source: 'builtin', tool: 'create_file' }],
    ['mcp__ops-api__create_incident', { source: 'mcp', server: 'ops-api', tool: 'create_incident' }],
    // Unknown server → custom, so hand-typed values never get silently re-homed.
    ['mcp__ghost__do-thing', { source: 'custom', value: 'mcp__ghost__do-thing' }],
    // A builtin OUTSIDE this job's list projects as custom (the picker only offers H8-satisfiable builtins).
    ['run_command', { source: 'custom', value: 'run_command' }],
    ['frobnicate', { source: 'custom', value: 'frobnicate' }],
    ['', { source: 'custom', value: '' }],
  ] as const)('%j', (value, expected) => {
    expect(parseActionValue(value, BUILTINS, SERVERS)).toEqual(expected);
  });
});

describe('composeMcpAction', () => {
  it('composes names the shared pattern accepts', () => {
    const composed = composeMcpAction('ops-api', 'create_incident');
    expect(composed).toBe('mcp__ops-api__create_incident');
    expect(MCP_ACTION_PATTERN.test(composed)).toBe(true);
  });
});

describe('actionHint (H8 mirror — warnings, never blockers)', () => {
  it.each([
    ['create_file', null],
    ['mcp__ops-api__create_incident', null],
    ['', null],
    // In the preset but excluded from this job → satisfiability warning.
    ['run_command', 'not-in-builtin'],
    ['frobnicate', 'unknown-tool'],
    ['mcp__ghost__do-thing', 'unknown-server'],
  ] as const)('%j → %j', (value, expected) => {
    expect(actionHint(value, BUILTINS, PRESET, SERVERS)).toBe(expected);
  });
});

describe('jobLacksArtifactWriter (H7 mirror)', () => {
  it('flags a job whose builtins carry no write-evidence tool', () => {
    expect(jobLacksArtifactWriter(['read_file', 'list_files'])).toBe(true);
    expect(jobLacksArtifactWriter(['read_file', 'create_file'])).toBe(false);
    // delete_file/mkdir mutate but never evidence a written file.
    expect(jobLacksArtifactWriter(['delete_file', 'mkdir'])).toBe(true);
  });
});
