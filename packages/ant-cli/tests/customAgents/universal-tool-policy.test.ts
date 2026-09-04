/**
 * Universal tool policy — reconciles the core-side allowlist SSOT
 * (`UNIVERSAL_BUILTIN_TOOLS`) with the tool layer (JOB_TOOL_MATRIX /
 * TOOL_HANDLERS / toolSchemas), and pins the approval-default table.
 *
 * The schema check matters most: `getToolsByNames` silently drops names
 * without an ARCHITECT_TOOLS entry, so a missing schema means a tool that
 * is registered and dispatchable but invisible to the LLM.
 */

import { describe, it, expect, afterEach } from 'vitest';
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

  it('result caps are at code-execute parity — ranged decompaction reads come back whole', async () => {
    const { universalToolNodeConfig } = await import('../../src/agents/universal/graph/nodes/tool');
    const manager = universalToolNodeConfig.resultManager!;
    // ~40k chars ≈ 14.3k tokens: over the 3000-token default clamp, under the
    // 16000 parity cap — a truncated slice here makes the outline →
    // read_file(startLine/endLine) decompaction cycle lossy.
    expect(manager.truncateResult('read_file', 'x'.repeat(40_000), undefined, 'big.md').wasTruncated).toBe(false);
    // ~10k chars ≈ 3.6k tokens: over the 2500-token default, under the 5000 parity cap.
    expect(manager.truncateResult('run_command', 'y'.repeat(10_000)).wasTruncated).toBe(false);
  });

  it('a truncated read_file names the omitted LINE RANGE, not just a count — a count-only marker sent readers back over ranges they already held', async () => {
    const { universalToolNodeConfig } = await import('../../src/agents/universal/graph/nodes/tool');
    const manager = universalToolNodeConfig.resultManager!;
    const big = Array.from({ length: 2000 }, (_, i) => `line ${i + 1}: ${'z'.repeat(40)}`).join('\n');
    const res = manager.truncateResult('read_file', big, undefined, 'big.md');
    expect(res.wasTruncated).toBe(true);
    const marker = /lines (\d+)-(\d+) omitted/.exec(res.content);
    expect(marker).not.toBeNull();
    const [, from, to] = marker!;
    // The guidance targets exactly the omitted window and warns off re-reads.
    expect(res.content).toContain(`startLine=${from}, endLine=${to}`);
    expect(res.content).toContain('head and tail above are complete');
  });

  it('buildReturn folds a successful create_file into _turnToolWrites — the universal file-evidence contract (session .artifacts stays empty by design)', async () => {
    const { universalToolNodeConfig } = await import('../../src/agents/universal/graph/nodes/tool');
    const state = { toolCalls: [], _turnToolWrites: ['earlier/kept.md'], _turnToolActions: [], recursionCount: 0 } as any;
    const executionEvents = [
      { toolName: 'create_file', args: { path: 'dependency-report/terms-notice.md' }, result: { content: 'File created' } },
      // A failed write never counts as evidence (completion-signal = actual-write).
      { toolName: 'create_file', args: { path: 'broken/nope.md' }, result: { content: 'x', error: 'EACCES' } },
    ] as any;
    const ret = universalToolNodeConfig.buildReturn(state, { updatedHistory: [], executionEvents } as any) as any;
    expect(ret._turnToolWrites).toEqual(['earlier/kept.md', 'dependency-report/terms-notice.md']);
    expect(ret._turnToolActions).toEqual(['create_file']);
  });

  it('buildContext wires featureHistory over session:main — read_state history is live, not a stub', async () => {
    const { universalToolNodeConfig } = await import('../../src/agents/universal/graph/nodes/tool');
    const fileSystem = { getRootPath: () => '/tmp/universal-artifacts' };
    const state = {
      deps: { fileSystem },
      featurePath: '/tmp/container',
      projectId: 'p',
      conversations: {
        'session:main': [
          { role: 'user', content: 'first ask', timestamp: '2026-08-27T00:00:00.000Z', metadata: { jobId: 'job-1' } },
          { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'read_file', input: {} }] },
          // tool_result round — a continuation, never a turn opener.
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'body' }] },
          { role: 'assistant', content: [{ type: 'text', text: 'first answer' }] },
          // Pre-stamp legacy turn — falls back to a synthesized index id.
          { role: 'user', content: 'legacy unstamped ask' },
          { role: 'assistant', content: 'second answer' },
        ],
      },
    } as any;

    const ctx = universalToolNodeConfig.buildContext(state);
    const turns = await ctx.featureHistory!();

    expect(turns).toEqual([
      { turnId: 'job-1', ts: '2026-08-27T00:00:00.000Z', userText: 'first ask', assistantFinalText: 'first answer' },
      { turnId: 'turn-2', ts: '', userText: 'legacy unstamped ask', assistantFinalText: 'second answer' },
    ]);
    // scope='run' stays the accurate stub — universal has no TaskQueue.
    expect(ctx.completedTasks).toBeUndefined();
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
    const readOnly = new Set([
      ToolName.READ_FILE, ToolName.LIST_FILES, ToolName.SEARCH_FILES,
      // ant-source family: domain-free read-only (see the preset test above) —
      // without it a universal explore child researching the platform itself
      // sees only the artifacts tree (pine-crafting-cargo).
      ToolName.READ_ANT_SOURCE, ToolName.LIST_ANT_FILES, ToolName.SEARCH_ANT_CODE,
    ]);
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

  it.each([
    ['_agent-definition', 'own-def:'],
    ['pipeline-runs', 'runs:'],
  ] as const)('bare mount root %s lists the mount root, not artifacts', async (p, expected) => {
    // Trailing-slash-only matching let bare roots fall through to the
    // artifacts adapter ("missing") — pine-crafting-cargo.
    await expect(build().listFiles(p)).resolves.toEqual([expected]);
  });

  it('root listing surfaces the listable mount roots', async () => {
    // Reachable-but-undiscoverable: a root listing showed only the artifacts
    // dir, so a job told to read `pipeline-runs/…` listed the root, did not
    // see it and skipped the read (two pipeline-builder review rounds did
    // exactly that). `_agents/` stays out — its root cannot be listed.
    await expect(build().listFiles('')).resolves.toEqual([
      'artifacts:',
      '_agent-definition/',
      'pipeline-runs/',
    ]);
  });

  it('a non-root artifacts listing is untouched by the mount roots', async () => {
    await expect(build().listFiles('plan')).resolves.toEqual(['artifacts:plan']);
  });

  it('bare _agents root is a mount error, never a fall-through to the artifacts root', () => {
    // Peer listing needs an agent id; the honest answer is the mount's own
    // refusal, not the artifacts adapter's "missing".
    expect(() => build().listFiles('_agents')).toThrow(/Cannot resolve mounted path/);
  });

  it.each([
    ['_agent-definition'],
    ['_agents'],
    ['pipeline-runs'],
  ] as const)('bare mount root %s refuses writes (no shadow directory in artifacts)', (p) => {
    const fs = build();
    expect(() => fs.createDirectory(p)).toThrow(/read-only/);
    expect(() => fs.writeFile(`${p}`, 'x')).toThrow(/read-only/);
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

  it('readFile forwards FileReadOptions on both branches (M-032 maxBytes backstop)', async () => {
    const calls: Array<{ tag: string; path: string; opts: unknown }> = [];
    const recording = (tag: string): FileSystemPort =>
      ({
        ...(port(tag) as any),
        readFile: async (p: string, opts?: unknown) => {
          calls.push({ tag, path: p, opts });
          return `${tag}:${p}`;
        },
      }) as unknown as FileSystemPort;
    const fs = createUniversalFileSystem(recording('artifacts'), [definitionMount(recording('own-def'))]);

    await fs.readFile('plan/notes.md', { maxBytes: 123 } as any);
    await fs.readFile('_agent-definition/agent.yaml', { maxBytes: 456 } as any);

    expect(calls).toEqual([
      { tag: 'artifacts', path: 'plan/notes.md', opts: { maxBytes: 123 } },
      { tag: 'own-def', path: 'agent.yaml', opts: { maxBytes: 456 } },
    ]);
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

// ── gateCall — approval rejection carries the user-visible notice ────────────
//
// The error string steers the model; the notice is what the orchestrator
// surfaces as a persistent chat card (the block is otherwise invisible
// outside narration). Shape only — no wording pinned beyond the knob name.

describe('gateCall — approval rejection notice shape', () => {
  const call = (name: string) => ({ id: 't1', name, args: {} });

  async function gateWith(resolvedOverrides: Partial<import('../../src/core/customAgents/types').ResolvedCustomJob>) {
    const { activateCustomJob, _resetActiveCustomJobForTests } = await import(
      '../../src/core/customAgents/activeCustomJob'
    );
    const { universalToolNodeConfig } = await import('../../src/agents/universal/graph/nodes/tool');
    _resetActiveCustomJobForTests();
    activateCustomJob({
      agentId: 'ops',
      jobId: 'weekly',
      scope: 'user',
      agentName: 'Ops',
      jobName: 'Weekly',
      prose: 'p',
      intents: [],
      intentPrompts: {},
      mcpServers: {},
      apiServers: {},
      onDemandDocs: [],
      builtinTools: ['read_file', 'run_command'],
      approval: {},
      clarifyDefault: true,
      agentDir: '/tmp/x',
      jobDir: '/tmp/x/jobs/weekly',
      ...resolvedOverrides,
    } as import('../../src/core/customAgents/types').ResolvedCustomJob);
    return (name: string) => universalToolNodeConfig.gateCall!({} as any, call(name));
  }

  afterEach(async () => {
    const { _resetActiveCustomJobForTests } = await import('../../src/core/customAgents/activeCustomJob');
    _resetActiveCustomJobForTests();
  });

  it('a default-gated builtin is rejected WITH a notice that deep-links the owning job.yaml', async () => {
    const gate = await gateWith({});
    const result = gate('run_command') as { allowed: false; error: string; notice?: any };
    expect(result.allowed).toBe(false);
    expect(result.error).toContain('tools.approval["run_command"]');
    expect(result.notice).toBeTruthy();
    expect(result.notice.content).toContain('run_command');
    expect(result.notice.agentId).toBe('ops');
    expect(result.notice.definitionPath).toBe('jobs/weekly/job.yaml');
  });

  it('a declared-never tool passes the gate (no notice, no rejection)', async () => {
    const gate = await gateWith({ approval: { run_command: 'never' } });
    expect(gate('run_command')).toEqual({ allowed: true });
  });

  it('a non-gated read tool passes untouched', async () => {
    const gate = await gateWith({});
    expect(gate('read_file')).toEqual({ allowed: true });
  });

  it('an allowlist rejection carries NO notice — model steering stays invisible to the user', async () => {
    const gate = await gateWith({ builtinTools: ['read_file'] });
    const result = gate('create_file') as { allowed: false; notice?: unknown };
    expect(result.allowed).toBe(false);
    expect(result.notice).toBeUndefined();
  });
});
