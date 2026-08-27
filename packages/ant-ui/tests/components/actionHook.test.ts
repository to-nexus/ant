/**
 * Action-hook value model — the raw ⇄ picker projection and the H7/H8
 * satisfiability-hint predicates the hook editor renders (warnings only; the
 * BE loader stays the authority). One row per case, per extension channel.
 */

import { describe, it, expect } from 'vitest';
import { API_ACTION_PATTERN, MCP_ACTION_PATTERN } from '@ant/shared';
import {
  actionHint,
  composeExtensionAction,
  defaultToolFor,
  jobLacksArtifactWriter,
  parseActionValue,
  type ExtensionServers,
} from '../../src/presentation/components/AgentSettings/overview/actionHook';

const BUILTINS = ['read_file', 'create_file'];
const PRESET = ['read_file', 'create_file', 'run_command', 'http_request'];
const SERVERS: ExtensionServers = { mcp: ['ops-api'], api: ['ant', 'ops-api'] };

describe('parseActionValue (raw → picker projection)', () => {
  it.each([
    ['create_file', { source: 'builtin', tool: 'create_file' }],
    [
      'mcp__ops-api__create_incident',
      { source: 'extension', channel: 'mcp', server: 'ops-api', tool: 'create_incident' },
    ],
    // An MCP tool name may itself contain '__' — the server ends at the FIRST separator.
    [
      'mcp__ops-api__do__thing',
      { source: 'extension', channel: 'mcp', server: 'ops-api', tool: 'do__thing' },
    ],
    // The declared-API channel: the shipped agent-builder's own hook.
    ['api__ant__request', { source: 'extension', channel: 'api', server: 'ant', tool: 'request' }],
    // Hyphenated server names round-trip on both channels.
    ['api__ops-api__get', { source: 'extension', channel: 'api', server: 'ops-api', tool: 'get' }],
    // Unknown server → custom, so hand-typed values never get silently re-homed.
    ['mcp__ghost__do-thing', { source: 'custom', value: 'mcp__ghost__do-thing' }],
    ['api__ghost__get', { source: 'custom', value: 'api__ghost__get' }],
    // A closed-vocabulary channel refuses a verb it cannot offer, rather than
    // hiding the typed value behind a picker with no matching option.
    ['api__ant__bogus', { source: 'custom', value: 'api__ant__bogus' }],
    // A builtin OUTSIDE this job's list projects as custom (the picker only offers H8-satisfiable builtins).
    ['run_command', { source: 'custom', value: 'run_command' }],
    ['frobnicate', { source: 'custom', value: 'frobnicate' }],
    ['', { source: 'custom', value: '' }],
  ] as const)('%j', (value, expected) => {
    expect(parseActionValue(value, BUILTINS, SERVERS)).toEqual(expected);
  });
});

describe('composeExtensionAction', () => {
  it.each([
    ['mcp', 'ops-api', 'create_incident', 'mcp__ops-api__create_incident', MCP_ACTION_PATTERN],
    ['api', 'ant', 'request', 'api__ant__request', API_ACTION_PATTERN],
    ['api', 'ops-api', 'get', 'api__ops-api__get', API_ACTION_PATTERN],
  ] as const)('%s/%s/%s', (channel, server, tool, expected, pattern) => {
    const composed = composeExtensionAction(channel, server, tool);
    expect(composed).toBe(expected);
    // The composed name is one the shared rule set accepts — the picker
    // cannot author a value the save gate would reject.
    expect(pattern.test(composed)).toBe(true);
  });

  it('starts a closed-vocabulary channel on its read-only half', () => {
    expect(defaultToolFor('api')).toBe('get');
    expect(API_ACTION_PATTERN.test(composeExtensionAction('api', 'ant', defaultToolFor('api')))).toBe(true);
    // MCP names its own tools, so there is nothing to default to.
    expect(defaultToolFor('mcp')).toBe('');
  });
});

describe('actionHint (H8 mirror — warnings, never blockers)', () => {
  it.each([
    ['create_file', null],
    ['mcp__ops-api__create_incident', null],
    // The regression: a synthesized declared-API tool is a real action, and
    // the BE accepts it at every gate — no warning belongs here.
    ['api__ant__request', null],
    ['api__ops-api__get', null],
    ['', null],
    // In the preset but excluded from this job → satisfiability warning.
    ['run_command', 'not-in-builtin'],
    ['frobnicate', 'unknown-tool'],
    ['mcp__ghost__do-thing', 'unknown-mcp-server'],
    ['api__ghost__get', 'unknown-api-server'],
    // A named channel with no server segment yet.
    ['mcp__', 'unknown-mcp-server'],
    ['api__', 'unknown-api-server'],
  ] as const)('%j → %j', (value, expected) => {
    expect(actionHint(value, BUILTINS, PRESET, SERVERS)).toBe(expected);
  });

  it('never reports a declared-channel action as an unknown builtin', () => {
    // Even a malformed verb stays a channel question, never "not a builtin".
    expect(actionHint('api__ant__bogus', BUILTINS, PRESET, SERVERS)).toBe(null);
    expect(actionHint('api__ghost__bogus', BUILTINS, PRESET, SERVERS)).toBe('unknown-api-server');
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
