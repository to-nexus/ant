/**
 * Universal tool policy — reconciles the core-side allowlist SSOT
 * (`UNIVERSAL_BUILTIN_TOOLS`) with the tool layer (JOB_TOOL_MATRIX /
 * TOOL_HANDLERS / toolSchemas), and pins the approval-default table.
 *
 * The schema check matters most: `getToolsByNames` silently drops names
 * without an ARCHITECT_TOOLS entry, so a missing schema means a tool that
 * is registered and dispatchable but invisible to the LLM.
 */

import { describe, it, expect } from 'vitest';
import {
  UNIVERSAL_BUILTIN_TOOLS,
  MUTATING_BUILTIN_TOOLS,
  ARTIFACT_WRITE_TOOLS,
  planTurnViolation,
  requiresApproval,
  isMcpToolName,
  isClarifyEnabled,
} from '../../src/core/customAgents/universalToolPolicy';
import type { CustomIntentDef } from '@ant/shared';
import {
  JOB_TOOL_MATRIX,
  JobType,
  TOOL_HANDLERS,
  TOOL_SETS,
  TOOL_DISPLAY_NAMES,
  ToolName,
} from '../../src/agents/common/tool/toolCatalog';
import { getToolsByNames } from '../../src/agents/common/tool/toolSchemas';
import {
  createUniversalFileSystem,
  definitionMount,
  peerAgentsMount,
  pipelineRunsMount,
} from '../../src/agents/universal/graph/runtime';
import type { FileSystemPort } from '../../src/core/ports/filesystem';
import { createUniversalToolRegistry } from '../../src/agents/common/tool/presets';

describe('UNIVERSAL_BUILTIN_TOOLS ↔ tool layer reconciliation', () => {
  it('equals JOB_TOOL_MATRIX[UNIVERSAL] as a set', () => {
    const policy = [...UNIVERSAL_BUILTIN_TOOLS].sort();
    const matrix = [...JOB_TOOL_MATRIX[JobType.UNIVERSAL]].map(String).sort();
    expect(policy).toEqual(matrix);
  });

  it('every tool has a schema entry (getToolsByNames drops missing ones silently)', () => {
    const names = JOB_TOOL_MATRIX[JobType.UNIVERSAL] as ToolName[];
    const defs = getToolsByNames([...names]);
    const defNames = new Set(defs.map((d) => d.name));
    for (const name of names) {
      expect(defNames.has(name), `tool "${name}" has no toolSchemas entry — the LLM never sees it`).toBe(true);
    }
  });

  it('every tool has a catalog handler (registry covers the full preset)', () => {
    const registry = createUniversalToolRegistry();
    for (const name of UNIVERSAL_BUILTIN_TOOLS) {
      expect(registry.has(name), `tool "${name}" has no TOOL_HANDLERS entry`).toBe(true);
    }
  });

  it('every tool has a display name', () => {
    for (const name of JOB_TOOL_MATRIX[JobType.UNIVERSAL]) {
      expect(TOOL_DISPLAY_NAMES[name], `tool "${name}" has no display name`).toBeTruthy();
    }
  });

  it('buildContext wires the CommandPort from deps (A12 — run_command must be executable, not just advertised)', async () => {
    const { universalToolNodeConfig } = await import('../../src/agents/universal/graph/nodes/tool');
    const command = { execute: () => { throw new Error('unused'); } };
    const fileSystem = { getRootPath: () => '/tmp/universal-artifacts' };
    const state = { deps: { fileSystem, command }, featurePath: '/tmp/container', projectId: 'p' } as any;
    const ctx = universalToolNodeConfig.buildContext(state);
    expect(ctx.command).toBe(command);
  });

  it('domain-bound tools stay excluded (search_code, workspace/reference, assets, figma)', () => {
    const forbidden = [
      'search_code', 'read_workspace_file', 'list_workspace_files', 'read_reference_file',
      'list_reference_files', 'search_reference_code', 'register_reference',
      'read_source_doc', 'list_assets', 'download_asset',
      'figma_get_design_context', 'figma_get_screenshot', 'figma_get_metadata', 'figma_get_variable_defs',
    ];
    for (const name of forbidden) {
      expect((UNIVERSAL_BUILTIN_TOOLS as readonly string[]).includes(name), `"${name}" must NOT be in the universal preset`).toBe(false);
    }
  });

  it('ant-source self-source tools are included (domain-free read-only — platform self-awareness)', () => {
    for (const name of ['read_ant_source', 'list_ant_files', 'search_ant_code']) {
      expect((UNIVERSAL_BUILTIN_TOOLS as readonly string[]).includes(name), `"${name}" must be in the universal preset`).toBe(true);
    }
  });

  it('subagentUniversal is read-only and never contains explore (depth-1)', () => {
    const readOnly = new Set([ToolName.READ_FILE, ToolName.LIST_FILES, ToolName.SEARCH_FILES]);
    for (const t of TOOL_SETS.subagentUniversal) {
      expect(readOnly.has(t), `subagentUniversal contains non-read-only tool "${t}"`).toBe(true);
    }
    expect(TOOL_SETS.subagentUniversal).not.toContain(ToolName.EXPLORE);
  });

  it('ARTIFACT_WRITE_TOOLS and MUTATING_BUILTIN_TOOLS are subsets of the preset', () => {
    for (const t of [...ARTIFACT_WRITE_TOOLS, ...MUTATING_BUILTIN_TOOLS]) {
      expect(UNIVERSAL_BUILTIN_TOOLS).toContain(t);
    }
  });
});

describe('planTurnViolation — @plan write confinement table', () => {
  it.each([
    // [label, tool, args, violates]
    ['create_file outside plan/', 'create_file', { path: 'reports/w.md' }, true],
    ['edit_file outside plan/', 'edit_file', { path: 'notes.md' }, true],
    ['append_file outside plan/', 'append_file', { path: 'log.txt' }, true],
    ['delete_file outside plan/', 'delete_file', { path: 'old.md' }, true],
    ['mkdir outside plan/', 'mkdir', { path: 'reports' }, true],
    ['copy_file dest outside plan/', 'copy_file', { src: 'plan/a.md', dest: 'reports/a.md' }, true],
    ['create_file under plan/', 'create_file', { path: 'plan/ops/weekly/plan.md' }, false],
    ['copy_file dest under plan/', 'copy_file', { src: 'notes.md', dest: 'plan/copy.md' }, false],
    ['./ prefix normalizes', 'create_file', { path: './plan/x.md' }, false],
    ['backslash separators normalize', 'create_file', { path: 'plan\\x.md' }, false],
    ['plan-prefixed sibling dir is NOT plan/', 'create_file', { path: 'planning/x.md' }, true],
    ['read tools never violate', 'read_file', { path: 'reports/w.md' }, false],
    ['search tools never violate', 'search_files', { query: 'x' }, false],
  ] as const)('%s', (_label, tool, args, violates) => {
    const result = planTurnViolation(tool, args as Record<string, unknown>);
    if (violates) {
      expect(result).toMatch(/PLAN turn/);
    } else {
      expect(result).toBeNull();
    }
  });
});

describe('requiresApproval — default table', () => {
  it.each([
    // [label, tool, declared, opts, expected]
    ['run_command defaults to always', 'run_command', {}, undefined, true],
    ['http_request defaults to always', 'http_request', {}, undefined, true],
    ['read_file defaults to no gate', 'read_file', {}, undefined, false],
    ['create_file (sandbox write) defaults to no gate', 'create_file', {}, undefined, false],
    ['explicit never relaxes a mutating builtin', 'run_command', { run_command: 'never' as const }, undefined, false],
    ['explicit always gates a read tool', 'read_file', { read_file: 'always' as const }, undefined, true],
    ['mcp tool defaults to always', 'mcp__db__push', {}, undefined, true],
    ['mcp read-only hint lifts the default', 'mcp__db__list', {}, { mcpReadOnlyHint: true }, false],
    ['explicit always wins over read-only hint', 'mcp__db__list', { mcp__db__list: 'always' as const }, { mcpReadOnlyHint: true }, true],
    ['explicit never wins for mcp', 'mcp__db__push', { mcp__db__push: 'never' as const }, undefined, false],
    // Declared REST APIs (apis) share the extension-tool mechanics: the get
    // tool carries readOnlyHint structurally, the request tool never does.
    ['api get with read-only hint is exempt', 'api__erp__get', {}, { mcpReadOnlyHint: true }, false],
    ['api request defaults to always (fail-closed)', 'api__erp__request', {}, { mcpReadOnlyHint: false }, true],
    ['explicit never relaxes an api write', 'api__erp__request', { api__erp__request: 'never' as const }, undefined, false],
  ])('%s', (_label, tool, declared, opts, expected) => {
    expect(requiresApproval(tool, declared as Record<string, 'always' | 'never'>, opts)).toBe(expected);
  });

  it('isMcpToolName recognizes the prefix', () => {
    expect(isMcpToolName('mcp__db__push')).toBe(true);
    expect(isMcpToolName('read_file')).toBe(false);
  });
});

describe('clarify — control tool OUTSIDE the preset planes', () => {
  it('is absent from the preset and the job matrix (availability owner is the knob, not tools.builtin)', () => {
    expect((UNIVERSAL_BUILTIN_TOOLS as readonly string[]).includes('clarify')).toBe(false);
    expect((JOB_TOOL_MATRIX[JobType.UNIVERSAL] as readonly string[]).map(String)).not.toContain('clarify');
    expect(Object.values(ToolName).map(String)).not.toContain('clarify');
  });

  it('has no registry handler (it never executes — the pause node consumes it)', () => {
    const registry = createUniversalToolRegistry();
    expect(registry.has('clarify' as ToolName)).toBe(false);
  });
});

describe('isClarifyEnabled — knob truth table', () => {
  const intent = (id: string, clarify?: boolean): CustomIntentDef => ({
    id,
    infer: `intent ${id}`,
    ...(clarify !== undefined ? { clarify } : {}),
  });

  it.each([
    // [label, clarifyDefault, intents, activeIntents, expected]
    ['default enabled (no knob anywhere)', true, [], ['general'], true],
    ['definition default false (job/agent knob)', false, [], ['general'], false],
    ['active intent true overrides default false', false, [intent('a', true)], ['a'], true],
    ['active intent false overrides default true', true, [intent('a', false)], ['a'], false],
    ['conflicting active intents → disabled wins', true, [intent('a', true), intent('b', false)], ['a', 'b'], false],
    ['agreeing active intents true', false, [intent('a', true), intent('b', true)], ['a', 'b'], true],
    ['inactive intent knob is ignored', true, [intent('a', false)], ['b'], true],
    ['active intent WITHOUT a knob falls through to default', false, [intent('a')], ['a'], false],
    ['knobless active + knobbed active → the declaring one decides', true, [intent('a'), intent('b', false)], ['a', 'b'], false],
    ['general-only → default (general matches no declared intent)', false, [intent('a', true)], ['general'], false],
  ])('%s', (_label, clarifyDefault, intents, activeIntents, expected) => {
    expect(isClarifyEnabled({ clarifyDefault, intents }, activeIntents)).toBe(expected);
  });
});

describe('createUniversalFileSystem — agent-plane mount table', () => {
  // The mount set IS the attachable set (`resolveUniversalAgentPlanePath`).
  // These rows pin the facade's routing and its read-only contract; drifting
  // either side re-creates the attachable-but-unreadable class of bug.
  const port = (tag: string): FileSystemPort =>
    ({
      readFile: async (p: string) => `${tag}:${p}`,
      fileExists: async (p: string) => p !== 'ghost',
      readDirectory: async () => [],
      listFiles: async (p: string) => [`${tag}:${p}`],
      isDirectory: async () => false,
      writeFile: async () => undefined,
      deleteFile: async () => undefined,
      createDirectory: async () => undefined,
      copyFile: async () => undefined,
      moveFile: async () => undefined,
      copyDirectory: async () => undefined,
      moveDirectory: async () => undefined,
      getRootPath: () => `/root/${tag}`,
      resolveAbsolute: (p: string) => `/root/${tag}/${p}`,
    }) as unknown as FileSystemPort;

  const build = () =>
    createUniversalFileSystem(port('artifacts'), [
      definitionMount(port('own-def')),
      peerAgentsMount(
        [{ scope: 'user', root: '/scope', readonly: false }],
        (root) => port(`peer:${root}`),
      ),
      pipelineRunsMount('/runs', () => port('runs')),
    ]);

  it.each([
    ['artifact path → artifacts root', 'plan/notes.md', 'artifacts:plan/notes.md'],
    ['own definition mount strips its prefix', '_agent-definition/agent.yaml', 'own-def:agent.yaml'],
    ['run log mount strips its prefix', 'pipeline-runs/r1.jsonl', 'runs:r1.jsonl'],
  ] as const)('%s', async (_label, p, expected) => {
    await expect(build().readFile(p)).resolves.toBe(expected);
  });

  it('an unresolvable peer id is an error, never a fall-through to the artifacts root', () => {
    // findAgentRoot requires an agent.yaml on disk. The facade rejects the
    // path outright — silently reading `artifacts/_agents/…` instead would be
    // the dead-promise bug in a new costume. (Throws synchronously, as every
    // mount refusal has since the facade existed.)
    expect(() => build().readFile('_agents/no-such-agent/agent.yaml')).toThrow(/Cannot resolve mounted path/);
  });

  it.each([
    ['_agent-definition/', '_agent-definition/agent.yaml'],
    ['_agents/', '_agents/payments-ops/agent.yaml'],
    ['pipeline-runs/', 'pipeline-runs/r1.jsonl'],
  ] as const)('every mount is read-only (%s)', (_prefix, p) => {
    const fs = build();
    expect(() => fs.writeFile(p, 'x')).toThrow(/read-only/);
    expect(() => fs.deleteFile(p)).toThrow(/read-only/);
    expect(() => fs.createDirectory(p)).toThrow(/read-only/);
    // Refused as EITHER operand — a copy out of a mount is still a mount write.
    expect(() => fs.copyFile(p, 'out.md')).toThrow(/read-only/);
    expect(() => fs.copyFile('in.md', p)).toThrow(/read-only/);
  });

  it('sessions/ is not a mount — it stays outside the sandbox entirely', async () => {
    // It resolves against artifacts (i.e. nowhere useful), which is why the
    // accept gate refuses it rather than letting the turn discover this.
    await expect(build().readFile('sessions/chat.jsonl')).resolves.toBe('artifacts:sessions/chat.jsonl');
  });

  it('getRootPath stays the artifacts root (ripgrep cwd — mounts are not searchable)', () => {
    expect(build().getRootPath()).toBe('/root/artifacts');
  });
});
