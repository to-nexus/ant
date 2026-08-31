/**
 * Definitions committed to this repository — validity + scope-root wiring.
 *
 * Two trees, opposite MCP contracts, one axis:
 *   src/core/data/agents/   loaded as the readonly `builtin` scope — MCP forbidden
 *   examples/custom-agents/ never loaded; copied by hand — MCP required
 *
 * discoverAgents is deliberately lenient (a broken definition is silently
 * skipped), so a malformed definition in either tree would vanish without
 * failing anything. This suite is the fail-loud gate.
 * Analogue of tests/prompt/prompt-smoke.test.ts for prompt assets.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {
  MCP_ENV_VAR_NAME_PATTERN,
  UNIVERSAL_BUILTIN_TOOLS,
  parseSecretRef,
  validateMcpServers,
} from '@ant/shared';
import {
  discoverAgents,
  loadCustomJob,
  type CustomAgentScopeRoot,
} from '../../src/core/customAgents/CustomAgentLoader';
import { deriveCustomAgentScopeRoots } from '../../src/core/customAgents/scopeRoots';
import { validateHooksFileDoc } from '../../src/core/customAgents/intents';
import { isSelfApiConfig } from '@ant/shared';
import { McpConnectionManager } from '../../src/core/customAgents/McpConnectionManager';
import {
  SELF_API_SURFACE_PREFIX,
  SELF_API_PIPELINES_PREFIX,
} from '../../src/periphery/adapters/http/middleware/selfApiScopeGuard';

const SRC_AGENTS_DIR = path.join(__dirname, '../../src/core/data/agents');

const builtinRoots: CustomAgentScopeRoot[] = [
  { scope: 'builtin', root: SRC_AGENTS_DIR, readonly: true },
];

/**
 * Non-Latin scripts (Hangul, Kana, CJK, Cyrillic, Arabic, Hebrew, Devanagari,
 * Thai). Deliberately NOT an ASCII-only test — the shipped prose uses em
 * dashes, arrows and emoji, which are fine.
 */
const NON_LATIN_SCRIPT =
  /[\u1100-\u11FF\u3040-\u30FF\u3130-\u318F\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0900-\u097F\u0E00-\u0E7F]/u;

function listFilesDeep(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const abs = path.join(dir, e.name);
    return e.isDirectory() ? listFilesDeep(abs) : [abs];
  });
}

function listDirs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

const shippedAgents = listDirs(SRC_AGENTS_DIR);
const shippedPairs = shippedAgents.flatMap((agentId) =>
  listDirs(path.join(SRC_AGENTS_DIR, agentId, 'jobs')).map((jobId) => [agentId, jobId] as const),
);

describe('shipped builtin definitions — smoke', () => {
  it('at least one sample ships', () => {
    expect(shippedPairs.length).toBeGreaterThan(0);
  });

  it.each(shippedPairs)('%s/%s loads and honors the shipping policy', (agentId, jobId) => {
    const resolved = loadCustomJob(builtinRoots, agentId, jobId);

    // Shipping policy: no MCP servers (arbitrary code + host env deps),
    // prose under the cap (no truncation footer).
    expect(Object.keys(resolved.mcpServers)).toEqual([]);
    expect(resolved.prose).not.toContain('[... truncated');

    // Same reason MCP is forbidden: a shipped definition may not assume an
    // install's URL or a registered credential. `self` is the one API form
    // that assumes neither — the runtime resolves both.
    for (const [name, cfg] of Object.entries(resolved.apiServers)) {
      expect(isSelfApiConfig(cfg), `builtin ${agentId}/${jobId} declares non-self api "${name}"`).toBe(true);
      expect((cfg as unknown as Record<string, unknown>).baseUrl).toBeUndefined();
      expect((cfg as unknown as Record<string, unknown>).headers).toBeUndefined();
    }

    // Every intent that advertises a prompt carries a preloaded non-blank body.
    for (const intent of resolved.intents) {
      if (intent.hasPrompt) {
        expect(resolved.intentPrompts[intent.id]?.trim().length ?? 0).toBeGreaterThan(0);
      } else {
        expect(resolved.intentPrompts[intent.id]).toBeUndefined();
      }
    }
  });

  it.each(shippedAgents)('%s carries no agent-level intents.yaml or injections/ (job-only)', (agentId) => {
    expect(fs.existsSync(path.join(SRC_AGENTS_DIR, agentId, 'intents.yaml'))).toBe(false);
    expect(fs.existsSync(path.join(SRC_AGENTS_DIR, agentId, 'injections'))).toBe(false);
  });

  // The English-only rule binds prompt source Ant SHIPS; user definitions under
  // `.ant/agents/**` follow their author's language (AGENTS.md § Prompt
  // Engineering 3). This is the gated half of that split — the ladder itself is
  // prose and is not pinned.
  it.each(shippedAgents)('%s is authored in Latin script (shipped source stays neutral)', (agentId) => {
    for (const file of listFilesDeep(path.join(SRC_AGENTS_DIR, agentId))) {
      const match = NON_LATIN_SCRIPT.exec(fs.readFileSync(file, 'utf-8'));
      expect(
        match,
        `${path.relative(SRC_AGENTS_DIR, file)} carries non-Latin script ("${match?.[0]}") — shipped definitions are English`,
      ).toBeNull();
    }
  });

  it('lenient discovery lists every shipped agent with all of its jobs', () => {
    const agents = discoverAgents(builtinRoots);
    expect(agents.map((a) => a.id).sort()).toEqual(shippedAgents);
    for (const agent of agents) {
      expect(agent.readonly).toBe(true);
      expect(agent.scope).toBe('builtin');
      expect(agent.jobs.map((j) => j.id).sort()).toEqual(
        listDirs(path.join(SRC_AGENTS_DIR, agent.id, 'jobs')),
      );
    }
  });
});

describe('committed example definitions — validity + MCP contract', () => {
  const EXAMPLES_DIR = path.resolve(__dirname, '../../../../examples/custom-agents');
  const exampleRoots: CustomAgentScopeRoot[] = [
    { scope: 'user', root: EXAMPLES_DIR, readonly: false },
  ];
  const exampleAgents = listDirs(EXAMPLES_DIR);
  const examplePairs = exampleAgents.flatMap((agentId) =>
    listDirs(path.join(EXAMPLES_DIR, agentId, 'jobs')).map((jobId) => [agentId, jobId] as const),
  );

  it('at least one example ships', () => {
    expect(examplePairs.length).toBeGreaterThan(0);
  });

  it.each(examplePairs)('%s/%s loads with a valid definition', (agentId, jobId) => {
    const resolved = loadCustomJob(exampleRoots, agentId, jobId);
    expect(validateMcpServers(resolved.mcpServers)).toEqual([]);
    for (const intent of resolved.intents) {
      if (intent.hasPrompt) {
        expect(resolved.intentPrompts[intent.id]?.trim().length ?? 0).toBeGreaterThan(0);
      }
    }
  });

  // The regression guard validateMcpServers cannot be: a bare `OPS_API_TOKEN`
  // is a VALID literal (credential-ness is authored, never inferred), so the
  // retired key-name form passes validation and then ships the literal string
  // as the header — a 401 with no config error. Nothing that looks like an
  // env-var name may appear unwrapped.
  it.each(examplePairs)('%s/%s wraps every credential-shaped value in ${secret:}', (agentId, jobId) => {
    const { mcpServers } = loadCustomJob(exampleRoots, agentId, jobId);
    for (const [name, cfg] of Object.entries(mcpServers)) {
      const slots = { ...(cfg.env ?? {}), ...(cfg.headers ?? {}) };
      for (const [key, value] of Object.entries(slots)) {
        if (parseSecretRef(value)) continue;
        expect(
          MCP_ENV_VAR_NAME_PATTERN.test(value),
          `${name}.${key} is the bare key name "${value}" — use \${secret:${value}}`,
        ).toBe(false);
      }
    }
  });

  it('at least one example declares an MCP server — the reason this tree exists', () => {
    const withMcp = examplePairs.filter(
      ([a, j]) => Object.keys(loadCustomJob(exampleRoots, a, j).mcpServers).length > 0,
    );
    expect(withMcp.length).toBeGreaterThan(0);
  });

  it('is not reachable through the runtime scope roots', () => {
    const roots = deriveCustomAgentScopeRoots('/ws/org/user/project');
    expect(roots.map((r) => path.resolve(r.root))).not.toContain(EXAMPLES_DIR);
  });
});

describe('builtin scope root wiring', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('builtin is always the last root, readonly, under core/data/agents', () => {
    const roots = deriveCustomAgentScopeRoots('/ws/org/user/project');
    const last = roots[roots.length - 1];
    expect(last.scope).toBe('builtin');
    expect(last.readonly).toBe(true);
    expect(last.root.endsWith(path.join('core', 'data', 'agents'))).toBe(true);
  });

  it('full priority order is user → org → builtin when org is set', () => {
    vi.stubEnv('ANT_CUSTOM_AGENTS_DIR', path.join(os.tmpdir(), 'org-agents'));
    const roots = deriveCustomAgentScopeRoots('/ws/org/user/project');
    expect(roots.map((r) => r.scope)).toEqual(['user', 'org', 'builtin']);
  });

  it('builtin root follows ANT_CLI_ROOT (job-runner child processes)', () => {
    const fakeCliRoot = path.join(os.tmpdir(), 'fake-cli-root');
    vi.stubEnv('ANT_CLI_ROOT', fakeCliRoot);
    const roots = deriveCustomAgentScopeRoots('/ws/org/user/project');
    expect(roots[roots.length - 1].root).toBe(path.join(fakeCliRoot, 'core/data/agents'));
  });
});

describe('shipped assistant definition', () => {
  it('assistant/chat exposes the job catalog — every intent carries its own prompt', () => {
    const resolved = loadCustomJob(builtinRoots, 'assistant', 'chat');
    expect(resolved.intents.map((i) => i.id).sort()).toEqual([
      'analysis',
      'coding',
      'research',
      'writing',
    ]);
    for (const intent of resolved.intents) {
      expect(intent.hasPrompt, `intent ${intent.id} ships without a prompt.md`).toBe(true);
      expect(resolved.intentPrompts[intent.id]?.trim().length ?? 0).toBeGreaterThan(0);
      // The guidance comments live inside the frontmatter fence — the rendered
      // criterion must be prose only.
      expect(intent.infer).not.toContain('#');
    }
  });

  it('ships the intended tool posture: no http_request, run_command pre-approved', () => {
    const resolved = loadCustomJob(builtinRoots, 'assistant', 'chat');
    expect(resolved.builtinTools).not.toContain('http_request');
    expect(resolved.builtinTools).toContain('run_command');
    expect(resolved.approval.run_command).toBe('never');
  });
});

describe('shipped agent-builder definition', () => {
  it('agent-builder/author exposes the authoring catalog — every intent carries its own prompt', () => {
    const resolved = loadCustomJob(builtinRoots, 'agent-builder', 'author');
    expect(resolved.intents.map((i) => i.id).sort()).toEqual(['build', 'review']);
    for (const intent of resolved.intents) {
      expect(intent.hasPrompt, `intent ${intent.id} ships without a prompt.md`).toBe(true);
      expect(intent.infer).not.toContain('#');
    }
  });

  it('the intents are units of work, not CRUD verbs — build contracts a real write, review never blocks', () => {
    const resolved = loadCustomJob(builtinRoots, 'agent-builder', 'author');
    const build = resolved.intents.find((i) => i.id === 'build');
    const review = resolved.intents.find((i) => i.id === 'review');
    // A pinned build turn is done only when a definition write went through
    // the API; the sanctioned no-op exit is clarify, which this gate exempts.
    expect(build?.hooks?.stop).toEqual([{ action: 'api__ant__request' }]);
    // Inspection reports with stated assumptions instead of blocking on questions.
    expect(review?.clarify).toBe(false);
    expect(review?.hooks).toBeUndefined();
  });

  /**
   * The declared scope is guidance for the model; the token's server-side pin
   * is the boundary (that the allow lines stay INSIDE the pin is asserted
   * against the guard itself in `tests/http/account-agent-routes.test.ts`).
   * What this row owns is the LANE: the builder authors AGENT definitions, and
   * the pin's other resource — pipeline definitions — is not its half.
   * Calendars and cross-intent run order are what this job FILTERS (doc 44);
   * an allow line naming the pipelines surface would hand it the very
   * authority that rule removes.
   */
  it('reaches this Ant server through a self entry — no URL, no credential', () => {
    const resolved = loadCustomJob(builtinRoots, 'agent-builder', 'author');
    expect(Object.keys(resolved.apiServers)).toEqual(['ant']);
    expect(isSelfApiConfig(resolved.apiServers.ant)).toBe(true);
    for (const rule of resolved.apiServers.ant.allow ?? []) {
      expect(rule.startsWith(`${rule.split(' ')[0]} ${SELF_API_SURFACE_PREFIX}`)).toBe(true);
      expect(rule).not.toContain(SELF_API_PIPELINES_PREFIX);
    }
  });

  it('authors through the validated API route, never from a shell', () => {
    const resolved = loadCustomJob(builtinRoots, 'agent-builder', 'author');
    expect(resolved.builtinTools).not.toContain('run_command');
    expect(resolved.builtinTools).not.toContain('http_request');
    // Writing definition files IS the job; its boundary is the scope pin and
    // the save gate, not an approval prompt per file.
    expect(resolved.approval.api__ant__request).toBe('never');
  });

  it('the shipped definition really synthesizes working tools against this server', async () => {
    vi.stubEnv('ANT_API_URL', 'http://localhost:4100');
    vi.stubEnv('ANT_SERVER_MODE', 'local');
    const resolved = loadCustomJob(builtinRoots, 'agent-builder', 'author');
    const mcp = new McpConnectionManager({}, { resolve: async () => undefined }, resolved.apiServers);
    await mcp.connect();
    expect(mcp.listToolInfos().map((t) => t.name)).toEqual(['api__ant__get', 'api__ant__request']);
    // Read-exempt vs write-gated, decided per tool name by the approval gate.
    expect(mcp.listToolInfos().map((t) => t.readOnlyHint)).toEqual([true, false]);
    await mcp.close();
  });

  it('carries its format contract as on-demand documents, not standing prose', () => {
    const docsDir = path.join(SRC_AGENTS_DIR, 'agent-builder', 'on-demand');
    expect(fs.readdirSync(docsDir).sort()).toEqual(['api-surface.md', 'definition-format.md']);
  });

  // `tools.builtin` is a CLOSED vocabulary the builder cannot infer: the doc
  // said "a name outside the preset is rejected" without listing the preset,
  // and an authored job.yaml came back declaring `clarify` (a knob, not a
  // tool). Vocabulary — not prose — is what this pins, in both directions.
  it('documents the whole builtin preset and nothing outside it', () => {
    const doc = fs.readFileSync(
      path.join(SRC_AGENTS_DIR, 'agent-builder', 'on-demand', 'definition-format.md'),
      'utf-8',
    );
    const documented = doc
      .split('\n')
      .filter((line) => line.startsWith('|'))
      .flatMap((line) => [...line.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]));
    expect(documented.sort()).toEqual([...UNIVERSAL_BUILTIN_TOOLS].sort());
  });

  // The doc's hooks.yaml example omitted the top-level `hooks` wrapper the gate
  // requires, so a job that followed it verbatim was refused 400 — the builtin
  // taught a violation of its own loader. Pin the EXAMPLE against the real
  // parser, not the prose: any yaml fence in the authoring doc that declares
  // hooks must be a file the loader accepts.
  it('every hooks.yaml example in the authoring doc parses through the real gate', () => {
    const doc = fs.readFileSync(
      path.join(SRC_AGENTS_DIR, 'agent-builder', 'on-demand', 'definition-format.md'),
      'utf-8',
    );
    const fences = [...doc.matchAll(/```yaml\n([\s\S]*?)```/g)].map((m) => m[1]);
    const hooksExamples = fences.filter((f) => /^\s*(hooks|stop):/m.test(f));
    expect(hooksExamples.length).toBeGreaterThan(0);
    for (const example of hooksExamples) {
      expect(() =>
        validateHooksFileDoc(yaml.load(example), 'build', 'agent-builder', 'author'),
      ).not.toThrow();
    }
  });
});

describe('account-scoped root derivation', () => {
  it('deriveCustomAgentScopeRootsFromUserDir anchors on the user dir directly', async () => {
    const { deriveCustomAgentScopeRootsFromUserDir } = await import('../../src/core/customAgents/scopeRoots');
    const roots = deriveCustomAgentScopeRootsFromUserDir('/ws/org/user');
    expect(roots[0]).toMatchObject({ scope: 'user', readonly: false });
    expect(roots[0].root).toBe(path.join('/ws/org/user', '.ant/agents'));
    // Project-scoped derivation is exactly the user-dir derivation of dirname(project).
    expect(deriveCustomAgentScopeRoots('/ws/org/user/project')).toEqual(roots);
  });

  // Both HTTP mounts (account settings + project composer) derive through
  // deriveCustomAgentScopeRootsForTenant with the SAME tenant context, so
  // identical tenants can never see different roots. For non-team kinds the
  // tenant derivation is byte-identical to the user-dir shim above.
  it('deriveCustomAgentScopeRootsForTenant (non-team) equals the user-dir derivation of the same tenant', async () => {
    const { deriveCustomAgentScopeRootsForTenant, deriveCustomAgentScopeRootsFromUserDir } =
      await import('../../src/core/customAgents/scopeRoots');
    for (const [kind, orgId, userId] of [
      ['local', 'local', 'local'],
      ['individual', 'individual', 'probe@to.nexus'],
    ] as const) {
      expect(
        deriveCustomAgentScopeRootsForTenant({ workspacesPath: '/ws', userId, organizationId: orgId, organizationKind: kind }),
      ).toEqual(deriveCustomAgentScopeRootsFromUserDir(path.join('/ws', orgId, userId)));
    }
  });
});
