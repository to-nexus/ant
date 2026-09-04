/**
 * Custom agent/job loader — validation table (job-only schema) + D8 scope
 * discovery. Fixtures are generated under os.tmpdir() per test (never
 * committed).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {
  discoverAgents,
  findAgentRoot,
  findCreateCollision,
  loadCustomJob,
  CUSTOM_PROSE_CAP,
  type CustomAgentScopeRoot,
} from '../../src/core/customAgents/CustomAgentLoader';
import { CustomAgentValidationError } from '../../src/core/customAgents/types';
import {
  activateCustomJob,
  getActiveCustomJob,
  requireActiveCustomJob,
  _resetActiveCustomJobForTests,
} from '../../src/core/customAgents/activeCustomJob';
import {
  gateDefinitionSave,
  DEFINITION_FILE_MAX_BYTES,
} from '../../src/periphery/adapters/http/routes/helpers/customAgentHandlers';

let tmpRoot: string;

function writeAgent(
  root: string,
  agentId: string,
  agentYaml: Record<string, unknown>,
  opts?: {
    base?: Record<string, string>;
  },
): string {
  const agentDir = path.join(root, agentId);
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(path.join(agentDir, 'agent.yaml'), yaml.dump({ id: agentId, name: agentId, ...agentYaml }));
  for (const [file, content] of Object.entries(opts?.base ?? {})) {
    fs.mkdirSync(path.join(agentDir, 'base'), { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'base', file), content);
  }
  return agentDir;
}

function writeJob(
  agentDir: string,
  jobId: string,
  jobYaml: Record<string, unknown>,
  opts?: {
    base?: Record<string, string>;
  },
): void {
  const jobDir = path.join(agentDir, 'jobs', jobId);
  fs.mkdirSync(jobDir, { recursive: true });
  fs.writeFileSync(path.join(jobDir, 'job.yaml'), yaml.dump({ id: jobId, name: jobId, ...jobYaml }));
  const base = opts?.base ?? { 'system.md': 'Job procedure.' };
  for (const [file, content] of Object.entries(base)) {
    fs.mkdirSync(path.join(jobDir, 'base'), { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'base', file), content);
  }
}

function roots(): CustomAgentScopeRoot[] {
  return [
    { scope: 'user', root: path.join(tmpRoot, 'user-agents'), readonly: false },
    { scope: 'org', root: path.join(tmpRoot, 'org-agents'), readonly: true },
    { scope: 'builtin', root: path.join(tmpRoot, 'builtin-agents'), readonly: true },
  ];
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-custom-agents-'));
  for (const r of roots()) fs.mkdirSync(r.root, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  _resetActiveCustomJobForTests();
});

describe('loadCustomJob — validation table', () => {
  it.each([
    ['invalid agent id charset', 'Ops_Team', 'weekly', /Invalid custom job ref/],
    ['invalid job id charset', 'ops', 'Weekly Report', /Invalid custom job ref/],
  ])('%s → throws', (_label, agentId, jobId, pattern) => {
    expect(() => loadCustomJob(roots(), agentId, jobId)).toThrow(pattern);
  });

  it('missing agent → throws not-found', () => {
    expect(() => loadCustomJob(roots(), 'ghost', 'job')).toThrow(/Custom agent not found/);
  });

  it('missing job.yaml → throws missing-file', () => {
    writeAgent(roots()[0].root, 'ops', {});
    expect(() => loadCustomJob(roots(), 'ops', 'ghost')).toThrow(/Missing definition file/);
  });

  it('agent.yaml id ≠ directory name → throws', () => {
    const dir = writeAgent(roots()[0].root, 'ops', { id: 'other' });
    writeJob(dir, 'weekly', {});
    expect(() => loadCustomJob(roots(), 'ops', 'weekly')).toThrow(/must equal its directory name/);
  });

  it('no prose anywhere → throws', () => {
    const dir = writeAgent(roots()[0].root, 'ops', {});
    writeJob(dir, 'weekly', {}, { base: {} });
    expect(() => loadCustomJob(roots(), 'ops', 'weekly')).toThrow(/has no prose/);
  });

  it('prose over the cap → truncated with footer', () => {
    const dir = writeAgent(roots()[0].root, 'ops', {});
    writeJob(dir, 'weekly', {}, { base: { 'system.md': 'x'.repeat(CUSTOM_PROSE_CAP + 500) } });
    const resolved = loadCustomJob(roots(), 'ops', 'weekly');
    expect(resolved.prose.length).toBeLessThan(CUSTOM_PROSE_CAP + 200);
    expect(resolved.prose).toContain('truncated');
  });

  it('job builtin outside the universal preset → throws', () => {
    const dir = writeAgent(roots()[0].root, 'ops', {});
    writeJob(dir, 'weekly', { tools: { builtin: ['search_code'] } });
    expect(() => loadCustomJob(roots(), 'ops', 'weekly')).toThrow(/universal preset/);
  });

  // tools.approval entries must name a callable tool with a literal policy —
  // a dead entry ships a false security posture (quiet-being-aspen audit).
  it('approval key not in tools.builtin → throws (dead entry)', () => {
    const dir = writeAgent(roots()[0].root, 'ops', {});
    writeJob(dir, 'weekly', { tools: { builtin: ['read_file'], approval: { http_request: 'never' } } });
    expect(() => loadCustomJob(roots(), 'ops', 'weekly')).toThrow(/not in this job's tools\.builtin/);
  });

  it('approval key in the default full preset passes when tools.builtin is omitted', () => {
    const dir = writeAgent(roots()[0].root, 'ops', {});
    writeJob(dir, 'weekly', { tools: { approval: { http_request: 'never' } } });
    expect(loadCustomJob(roots(), 'ops', 'weekly').approval.http_request).toBe('never');
  });

  it('mcp__ approval key requires a declared server; any tool suffix passes once declared', () => {
    const dir = writeAgent(roots()[0].root, 'ops', {
      mcp: { servers: { db: { transport: 'stdio', command: 'npx' } } },
    });
    writeJob(dir, 'weekly', { tools: { approval: { mcp__db__any_tool: 'always' } } });
    expect(loadCustomJob(roots(), 'ops', 'weekly').approval.mcp__db__any_tool).toBe('always');

    const dir2 = writeAgent(roots()[0].root, 'ops2', {});
    writeJob(dir2, 'weekly', { tools: { approval: { mcp__ghost__tool: 'always' } } });
    expect(() => loadCustomJob(roots(), 'ops2', 'weekly')).toThrow(/no MCP server "ghost"|not declared in mcp\.servers/);
  });

  it('api__ approval key follows the same declared-server rule', () => {
    const dir = writeAgent(roots()[0].root, 'ops', {
      apis: { erp: { baseUrl: 'https://erp.example.com/api' } },
    });
    writeJob(dir, 'weekly', { tools: { approval: { api__erp__request: 'always' } } });
    expect(loadCustomJob(roots(), 'ops', 'weekly').approval.api__erp__request).toBe('always');

    const dir2 = writeAgent(roots()[0].root, 'ops2', {});
    writeJob(dir2, 'weekly', { tools: { approval: { api__ghost__request: 'always' } } });
    expect(() => loadCustomJob(roots(), 'ops2', 'weekly')).toThrow(/not declared in apis/);
  });

  it('unrecognized approval key → throws (typo guard)', () => {
    const dir = writeAgent(roots()[0].root, 'ops', {});
    writeJob(dir, 'weekly', { tools: { approval: { htp_request: 'never' } } });
    expect(() => loadCustomJob(roots(), 'ops', 'weekly')).toThrow(/not a recognized tool name/);
  });

  it('non-literal approval value → throws (YAML 1.1 yes/no pitfall)', () => {
    const dir = writeAgent(roots()[0].root, 'ops', {});
    // yaml.dump would re-quote a string; a real `yes` in YAML 1.1 arrives as boolean true.
    writeJob(dir, 'weekly', { tools: { builtin: ['run_command'], approval: { run_command: true } } });
    expect(() => loadCustomJob(roots(), 'ops', 'weekly')).toThrow(/must be 'always' or 'never'/);
  });

  it('mcp env carrying a literal value loads through — plain text is authored, not refused', () => {
    const dir = writeAgent(roots()[0].root, 'ops', {
      mcp: { servers: { db: { transport: 'stdio', command: 'npx', env: { DB_URL: 'postgres://user:pw@host' } } } },
    });
    writeJob(dir, 'weekly', {});
    expect(loadCustomJob(roots(), 'ops', 'weekly').mcpServers.db.env).toEqual({
      DB_URL: 'postgres://user:pw@host',
    });
  });

  // `${secret:KEY}` is the ONLY marker that turns a value into a store lookup,
  // so an ALL-CAPS literal is just a literal — the shape carries no meaning.
  it('mcp env carrying a bare ALL-CAPS value loads through as plain text', () => {
    const dir = writeAgent(roots()[0].root, 'ops', {
      mcp: { servers: { db: { transport: 'stdio', command: 'npx', env: { DB_URL: 'OPS_DB_URL' } } } },
    });
    writeJob(dir, 'weekly', {});
    expect(loadCustomJob(roots(), 'ops', 'weekly').mcpServers.db.env).toEqual({ DB_URL: 'OPS_DB_URL' });
  });

  it('mcp stdio without command / http without url → throws', () => {
    const dir = writeAgent(roots()[0].root, 'ops', { mcp: { servers: { a: { transport: 'stdio' } } } });
    writeJob(dir, 'weekly', {});
    expect(() => loadCustomJob(roots(), 'ops', 'weekly')).toThrow(/requires "command"/);

    const dir2 = writeAgent(roots()[0].root, 'ops2', { mcp: { servers: { b: { transport: 'http' } } } });
    writeJob(dir2, 'weekly', {});
    expect(() => loadCustomJob(roots(), 'ops2', 'weekly')).toThrow(/requires "url"/);
  });

  // http `headers` — the ONE auth mechanism for http MCP. Same value rule as
  // `env`: plain text verbatim, or a `${secret:KEY}` credential reference.
  it.each([
    [
      'headers with a malformed secret reference',
      { transport: 'http', url: 'http://localhost:9', headers: { Authorization: '${secret:not-caps}' } },
      /malformed/,
    ],
    [
      'headers with an invalid header name',
      { transport: 'http', url: 'http://localhost:9', headers: { 'Bad Header': '${secret:OPS_TOKEN}' } },
      /not a valid HTTP header name/,
    ],
    [
      'headers on stdio transport',
      { transport: 'stdio', command: 'npx', headers: { Authorization: '${secret:OPS_TOKEN}' } },
      /"headers" applies to http transport only/,
    ],
  ] as const)('mcp %s → throws', (_label, server, pattern) => {
    const dir = writeAgent(roots()[0].root, 'ops', { mcp: { servers: { s: server } } });
    writeJob(dir, 'weekly', {});
    expect(() => loadCustomJob(roots(), 'ops', 'weekly')).toThrow(pattern);
  });

  it('http headers mixing a secret reference and plain text load through to the resolved job', () => {
    const dir = writeAgent(roots()[0].root, 'ops', {
      mcp: {
        servers: {
          api: {
            transport: 'http',
            url: 'http://localhost:9',
            headers: { Authorization: '${secret:OPS_TOKEN}', 'X-Workspace-Id': 'ws-abc' },
          },
        },
      },
    });
    writeJob(dir, 'weekly', {});
    expect(loadCustomJob(roots(), 'ops', 'weekly').mcpServers.api.headers).toEqual({
      Authorization: '${secret:OPS_TOKEN}',
      'X-Workspace-Id': 'ws-abc',
    });
  });
});

describe('loadCustomJob — legacy schema fails loud with migration messages', () => {
  it.each([
    ['agent.yaml tools', { tools: { builtin: ['read_file'] } }, /"tools" moved to job level/],
    ['agent.yaml description', { description: 'legacy' }, /"description" was removed/],
    ['agent.yaml workspace', { workspace: 'none' }, /"workspace" was removed/],
    ['agent.yaml models', { models: { default: 'x' } }, /"models" was removed/],
    ['agent.yaml intents key', { intents: [] }, /intents belong in jobs/],
  ] as const)('%s → throws', (_label, agentYaml, pattern) => {
    const dir = writeAgent(roots()[0].root, 'ops', agentYaml as Record<string, unknown>);
    writeJob(dir, 'weekly', {});
    expect(() => loadCustomJob(roots(), 'ops', 'weekly')).toThrow(pattern);
  });

  it.each([
    ['job.yaml outputs', { outputs: { mode: 'free' } }, /"outputs" was removed/],
    ['job.yaml plan', { plan: 'suggested' }, /"plan" was removed/],
    ['job.yaml description', { description: 'legacy' }, /"description" was removed/],
    ['job.yaml workspace', { workspace: 'read' }, /"workspace" was removed/],
    ['job.yaml models', { models: { default: 'x' } }, /"models" was removed/],
  ] as const)('%s → throws', (_label, jobYaml, pattern) => {
    const dir = writeAgent(roots()[0].root, 'ops', {});
    writeJob(dir, 'weekly', jobYaml as Record<string, unknown>);
    expect(() => loadCustomJob(roots(), 'ops', 'weekly')).toThrow(pattern);
  });

  it('agent-level intents.yaml on disk → throws move instruction', () => {
    const dir = writeAgent(roots()[0].root, 'ops', {});
    writeJob(dir, 'weekly', {});
    fs.writeFileSync(path.join(dir, 'intents.yaml'), 'version: 1\nintents: []\n');
    expect(() => loadCustomJob(roots(), 'ops', 'weekly')).toThrow(/Agent-level intents\.yaml is no longer supported/);
  });

  it('agent-level injections/ on disk → throws move instruction', () => {
    const dir = writeAgent(roots()[0].root, 'ops', {});
    writeJob(dir, 'weekly', {});
    fs.mkdirSync(path.join(dir, 'injections'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'injections', 'style.md'), 'Legacy prose.');
    expect(() => loadCustomJob(roots(), 'ops', 'weekly')).toThrow(/Agent-level injections\/ is no longer supported/);
  });

  // Hard cutover: the directory itself is the retired shape — even empty
  // (old scaffolds created one), the author must delete it.
  it('an EMPTY agent-level injections/ dir also fails loud', () => {
    const dir = writeAgent(roots()[0].root, 'ops', {});
    writeJob(dir, 'weekly', {});
    fs.mkdirSync(path.join(dir, 'injections'), { recursive: true });
    expect(() => loadCustomJob(roots(), 'ops', 'weekly')).toThrow(/Agent-level injections\/ is no longer supported/);
  });

  // The rename is a hard cutover for the same reason the injections removal
  // was: an author whose docs silently stopped being listed would conclude the
  // channel works. Both levels refuse, and the message names the new directory.
  it.each([
    ['agent-level', ['reference'], /Agent-level reference\/ was renamed to on-demand\//],
    ['job-level', ['jobs', 'weekly', 'reference'], /reference\/ was renamed to on-demand\//],
  ] as const)('%s reference/ on disk → throws rename instruction', (_label, segments, expected) => {
    const dir = writeAgent(roots()[0].root, 'ops', {});
    writeJob(dir, 'weekly', {});
    fs.mkdirSync(path.join(dir, ...segments), { recursive: true });
    fs.writeFileSync(path.join(dir, ...segments, 'spec.md'), '# spec');
    expect(() => loadCustomJob(roots(), 'ops', 'weekly')).toThrow(expected);
  });

  it('job-level injections/*.md on disk → throws move instruction', () => {
    const dir = writeAgent(roots()[0].root, 'ops', {});
    writeJob(dir, 'weekly', {});
    fs.mkdirSync(path.join(dir, 'jobs', 'weekly', 'injections'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'jobs', 'weekly', 'injections', 'style.md'), 'Legacy prose.');
    expect(() => loadCustomJob(roots(), 'ops', 'weekly')).toThrow(/injections\/ was removed/);
  });

  it('an EMPTY job-level injections/ dir also fails loud', () => {
    const dir = writeAgent(roots()[0].root, 'ops', {});
    writeJob(dir, 'weekly', {});
    fs.mkdirSync(path.join(dir, 'jobs', 'weekly', 'injections'), { recursive: true });
    expect(() => loadCustomJob(roots(), 'ops', 'weekly')).toThrow(/injections\/ was removed/);
  });
});

describe('loadCustomJob — composition (job-only tools, mcp union)', () => {
  it('composes agent prose + job everything-else', () => {
    const dir = writeAgent(
      roots()[0].root,
      'ops',
      { mcp: { servers: { shared: { transport: 'stdio', command: 'npx' } } } },
      { base: { 'a-persona.md': 'AGENT PERSONA' } },
    );
    writeJob(
      dir,
      'weekly',
      {
        tools: { builtin: ['read_file', 'create_file', 'fetch_url'], approval: { fetch_url: 'always', create_file: 'always' } },
        mcp: { servers: { jobonly: { transport: 'http', url: 'http://localhost:9' } } },
      },
      {
        base: { 'system.md': 'JOB PROCEDURE' },
      },
    );

    const resolved = loadCustomJob(roots(), 'ops', 'weekly');

    // prose: agent base before job base
    expect(resolved.prose.indexOf('AGENT PERSONA')).toBeLessThan(resolved.prose.indexOf('JOB PROCEDURE'));
    // mcp union (the one field that still composes agent ∪ job)
    expect(Object.keys(resolved.mcpServers).sort()).toEqual(['jobonly', 'shared']);
    // builtin = the job's declaration
    expect(resolved.builtinTools.sort()).toEqual(['create_file', 'fetch_url', 'read_file']);
    // approval = job-declared only
    expect(resolved.approval).toEqual({ fetch_url: 'always', create_file: 'always' });
  });

  it('mcp union: job wins on server-name collision', () => {
    const dir = writeAgent(roots()[0].root, 'ops', {
      mcp: { servers: { db: { transport: 'stdio', command: 'agent-cmd' } } },
    }, { base: { 'p.md': 'Persona.' } });
    writeJob(dir, 'weekly', {
      mcp: { servers: { db: { transport: 'stdio', command: 'job-cmd' } } },
    });
    const resolved = loadCustomJob(roots(), 'ops', 'weekly');
    expect(resolved.mcpServers.db.command).toBe('job-cmd');
  });

  it('job without tools.builtin defaults to the full universal preset', () => {
    const dir = writeAgent(roots()[0].root, 'ops', {});
    writeJob(dir, 'weekly', {});
    const resolved = loadCustomJob(roots(), 'ops', 'weekly');
    expect(resolved.builtinTools).toContain('read_file');
    expect(resolved.builtinTools).toContain('run_command');
  });

  it('apis union mirrors mcp: agent ∪ job, job wins on name collision', () => {
    const dir = writeAgent(roots()[0].root, 'ops', {
      apis: { erp: { baseUrl: 'https://agent.example.com/api' }, shared: { baseUrl: 'https://s.example.com' } },
    }, { base: { 'p.md': 'Persona.' } });
    writeJob(dir, 'weekly', {
      apis: { erp: { baseUrl: 'https://job.example.com/api', headers: { Authorization: '${secret:ERP_TOKEN}' } } },
    });
    const resolved = loadCustomJob(roots(), 'ops', 'weekly');
    expect(Object.keys(resolved.apiServers).sort()).toEqual(['erp', 'shared']);
    expect(resolved.apiServers.erp.baseUrl).toBe('https://job.example.com/api');
  });

  it('an invalid apis entry fails loud as CustomAgentValidationError (same shape as mcp)', () => {
    const dir = writeAgent(roots()[0].root, 'ops', { apis: { erp: {} } });
    writeJob(dir, 'weekly', {});
    expect(() => loadCustomJob(roots(), 'ops', 'weekly')).toThrow(CustomAgentValidationError);
    expect(() => loadCustomJob(roots(), 'ops', 'weekly')).toThrow(/"baseUrl" is required/);
  });

  it('a job with no apis resolves to an empty map', () => {
    const dir = writeAgent(roots()[0].root, 'ops', {});
    writeJob(dir, 'weekly', {});
    expect(loadCustomJob(roots(), 'ops', 'weekly').apiServers).toEqual({});
  });
});

describe('discoverAgents — D8 scope priority', () => {
  it('merges scopes; closer scope wins id collisions; readonly flag rides the scope', () => {
    const u = writeAgent(roots()[0].root, 'dup', { name: 'user version' });
    writeJob(u, 'j1', {});
    const o = writeAgent(roots()[1].root, 'dup', { name: 'org version' });
    writeJob(o, 'j2', {});
    const uo = writeAgent(roots()[0].root, 'user-only', {});
    writeJob(uo, 'j3', {});
    const oa = writeAgent(roots()[1].root, 'org-agent', {});
    writeJob(oa, 'j4', {});

    const agents = discoverAgents(roots());
    const byId = new Map(agents.map((a) => [a.id, a]));

    expect(byId.get('dup')!.name).toBe('user version');
    expect(byId.get('dup')!.scope).toBe('user');
    expect(byId.get('dup')!.jobs.map((j) => j.id)).toEqual(['j1']);
    expect(byId.get('user-only')!.scope).toBe('user');
    expect(byId.get('user-only')!.readonly).toBe(false);
    expect(byId.get('org-agent')!.readonly).toBe(true);
  });

  it('a broken sibling job does not hide the healthy ones (lenient discovery)', () => {
    const dir = writeAgent(roots()[0].root, 'ops', {});
    writeJob(dir, 'good', {});
    const badDir = path.join(dir, 'jobs', 'bad');
    fs.mkdirSync(badDir, { recursive: true });
    fs.writeFileSync(path.join(badDir, 'job.yaml'), '{{{{not yaml');
    const agents = discoverAgents(roots());
    expect(agents[0].jobs.map((j) => j.id)).toEqual(['good']);
  });

  it('findAgentRoot follows priority order', () => {
    writeAgent(roots()[1].root, 'ops', {});
    expect(findAgentRoot(roots(), 'ops')!.scopeRoot.scope).toBe('org');
    writeAgent(roots()[0].root, 'ops', {});
    expect(findAgentRoot(roots(), 'ops')!.scopeRoot.scope).toBe('user');
  });

  it('a user agent shadows a same-id builtin agent wholesale; builtin-only surfaces readonly', () => {
    const b = writeAgent(roots()[2].root, 'sample', { name: 'builtin version' });
    writeJob(b, 'builtin-job', {});
    const bOnly = writeAgent(roots()[2].root, 'builtin-only', {});
    writeJob(bOnly, 'j1', {});
    const u = writeAgent(roots()[0].root, 'sample', { name: 'user version' });
    writeJob(u, 'user-job', {});

    const byId = new Map(discoverAgents(roots()).map((a) => [a.id, a]));
    expect(byId.get('sample')!.name).toBe('user version');
    expect(byId.get('sample')!.readonly).toBe(false);
    expect(byId.get('sample')!.jobs.map((j) => j.id)).toEqual(['user-job']); // no job union
    expect(byId.get('builtin-only')!.scope).toBe('builtin');
    expect(byId.get('builtin-only')!.readonly).toBe(true);
  });

  it.each([
    ['builtin id → blocks (no silent shadowing of shipped agents)', 2, 'builtin'],
    ['org id → blocks (readonly ownership refuses new creations)', 1, 'org'],
    ['user id → blocks', 0, 'user'],
    ['free id → creatable', null, null],
  ] as const)('findCreateCollision: %s', (_label, rootIdx, expected) => {
    if (rootIdx !== null) writeAgent(roots()[rootIdx].root, 'dup', {});
    const collision = findCreateCollision(roots(), 'dup');
    if (expected === null) {
      expect(collision).toBeNull();
    } else {
      expect(collision!.scopeRoot.scope).toBe(expected);
    }
  });
});

// ── tenant-aware scope-root derivation (org-owned agents) ────────────────────

describe('deriveCustomAgentScopeRootsForTenant', () => {
  async function forTenant(kind: 'local' | 'individual' | 'team', orgId: string, userId = 'probe@to.nexus') {
    const { deriveCustomAgentScopeRootsForTenant } = await import('../../src/core/customAgents/scopeRoots');
    return deriveCustomAgentScopeRootsForTenant({
      workspacesPath: '/ws',
      userId,
      organizationId: orgId,
      organizationKind: kind,
    });
  }

  it('local kind → byte-identical to the historical user-dir derivation', async () => {
    const { deriveCustomAgentScopeRootsFromUserDir } = await import('../../src/core/customAgents/scopeRoots');
    expect(await forTenant('local', 'local', 'local')).toEqual(
      deriveCustomAgentScopeRootsFromUserDir(path.join('/ws', 'local', 'local')),
    );
  });

  it('individual kind → anchored on the individual org user dir (same as today)', async () => {
    const roots = await forTenant('individual', 'individual');
    expect(roots[0].root).toBe(path.join('/ws', 'individual', 'probe@to.nexus', '.ant/agents'));
    expect(roots[0]).toMatchObject({ scope: 'user', readonly: false });
    // No per-org ACL root outside team kind.
    expect(roots.some((r) => r.aclGoverned)).toBe(false);
  });

  it('team kind → individual-anchored user root, per-org ACL root, builtin (in order); the pre-org-agents team path is NOT served', async () => {
    const roots = await forTenant('team', 'acme');
    expect(roots.map((r) => r.scope)).toEqual(['user', 'org', 'builtin']);
    // ① personal agents live under the INDIVIDUAL org regardless of active org (D1 fix).
    expect(roots[0]).toMatchObject({ scope: 'user', readonly: false });
    expect(roots[0].root).toBe(path.join('/ws', 'individual', 'probe@to.nexus', '.ant/agents'));
    // ② the per-org shared root is ACL-governed (structurally writable).
    expect(roots[1]).toMatchObject({ scope: 'org', readonly: false, aclGoverned: true });
    expect(roots[1].root).toBe(path.join('/ws', 'acme', '.ant/agents'));
    // Retired: the old team-path user root ({ws}/{orgId}/{user}) must not appear.
    expect(roots.some((r) => r.root === path.join('/ws', 'acme', 'probe@to.nexus', '.ant/agents'))).toBe(false);
  });

  it('team kind + ANT_CUSTOM_AGENTS_DIR → env dir slots BELOW the per-org root, readonly', async () => {
    process.env.ANT_CUSTOM_AGENTS_DIR = '/global/agents';
    try {
      const roots = await forTenant('team', 'acme');
      expect(roots.map((r) => r.scope)).toEqual(['user', 'org', 'org', 'builtin']);
      const aclIdx = roots.findIndex((r) => r.aclGoverned);
      const envIdx = roots.findIndex((r) => r.root === '/global/agents');
      expect(aclIdx).toBeLessThan(envIdx);
      expect(roots[envIdx]).toMatchObject({ scope: 'org', readonly: true });
      expect(roots[envIdx].aclGoverned).toBeUndefined();
    } finally {
      delete process.env.ANT_CUSTOM_AGENTS_DIR;
    }
  });

  it('discoverAgents projects an aclGoverned root as readonly (conservative default the route layer flips)', () => {
    const aclRoot: CustomAgentScopeRoot = {
      scope: 'org',
      root: path.join(tmpRoot, 'org-acl-agents'),
      readonly: false,
      aclGoverned: true,
    };
    fs.mkdirSync(aclRoot.root, { recursive: true });
    const dir = writeAgent(aclRoot.root, 'shared', {});
    writeJob(dir, 'weekly', {});
    const agents = discoverAgents([aclRoot]);
    expect(agents[0]).toMatchObject({ id: 'shared', scope: 'org', readonly: true });
  });

});

describe('activeCustomJob singleton', () => {
  it('activates once; double activation throws; require works', () => {
    const dir = writeAgent(roots()[0].root, 'ops', {});
    writeJob(dir, 'weekly', {});
    const resolved = loadCustomJob(roots(), 'ops', 'weekly');

    expect(getActiveCustomJob()).toBeNull();
    expect(() => requireActiveCustomJob()).toThrow(/No active custom job/);

    activateCustomJob(resolved);
    expect(requireActiveCustomJob().jobId).toBe('weekly');
    expect(() => activateCustomJob(resolved)).toThrow(/already active/);
  });
});

describe('error type', () => {
  it('loader failures are CustomAgentValidationError (HTTP 400 mapping)', () => {
    try {
      loadCustomJob(roots(), 'ghost', 'job');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(CustomAgentValidationError);
    }
  });
});

// ── intents/{intentId}/ (job-only per-intent directory catalog, D-A) ─────────

/**
 * Write one intent directory. `files.infer` is the raw infer.md text
 * (defaults to a minimal criterion); `files.prompt` writes the optional
 * prompt.md; `files.hooks` writes the optional hooks.yaml (object dumped as
 * YAML, or a raw string for malformed rows).
 */
function writeIntent(
  agentDir: string,
  jobId: string,
  intentId: string,
  files: { infer?: string; prompt?: string; hooks?: Record<string, unknown> | string } = {},
): void {
  const dir = path.join(agentDir, 'jobs', jobId, 'intents', intentId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'infer.md'), files.infer ?? 'x\n');
  if (files.prompt !== undefined) {
    fs.writeFileSync(path.join(dir, 'prompt.md'), files.prompt);
  }
  if (files.hooks !== undefined) {
    fs.writeFileSync(
      path.join(dir, 'hooks.yaml'),
      typeof files.hooks === 'string' ? files.hooks : yaml.dump(files.hooks),
    );
  }
}

describe('loadCustomJob — intents catalog validation table', () => {
  type IntentFiles = Record<string, { infer?: string; prompt?: string; hooks?: Record<string, unknown> | string }>;

  function setup(intentDirs?: IntentFiles): string {
    const agentDir = writeAgent(roots()[0].root, 'ops', {}, {
      base: { 'system.md': 'Persona.' },
    });
    writeJob(agentDir, 'weekly', {});
    for (const [intentId, files] of Object.entries(intentDirs ?? {})) {
      writeIntent(agentDir, 'weekly', intentId, files);
    }
    return agentDir;
  }

  it('absent intents/ directory → empty catalog (zero-cost path)', () => {
    setup();
    const resolved = loadCustomJob(roots(), 'ops', 'weekly');
    expect(resolved.intents).toEqual([]);
    expect(resolved.intentPrompts).toEqual({});
  });

  it('leftover single-file intents.yaml → throws the replaced-layout message', () => {
    const agentDir = setup({ a: {} });
    fs.writeFileSync(path.join(agentDir, 'jobs', 'weekly', 'intents.yaml'), 'version: 1\nintents: []\n');
    expect(() => loadCustomJob(roots(), 'ops', 'weekly')).toThrow(/was replaced by per-intent directories/);
  });

  it.each([
    // ── infer.md (frontmatter grammar + criterion body) ──
    ['reserved general directory', { general: {} }, /implicit fallback/],
    ['empty criterion body', { a: { infer: '   \n' } }, /non-empty body/],
    ['body over the cap', { a: { infer: 'x'.repeat(1001) } }, /exceeds 1000/],
    ['unterminated frontmatter fence', { a: { infer: '---\nclarify: false\ncriterion\n' } }, /never closes/],
    ['frontmatter not a mapping', { a: { infer: '---\n- a\n---\nx\n' } }, /must be a YAML mapping/],
    ['frontmatter default (removed knob)', { a: { infer: '---\ndefault: true\n---\nx\n' } }, /"default" was removed/],
    ['frontmatter injections (removed knob)', { a: { infer: '---\ninjections: [f.md]\n---\nx\n' } }, /"injections" was removed/],
    ['frontmatter description (body IS the criterion)', { a: { infer: '---\ndescription: x\n---\nx\n' } }, /not a frontmatter key/],
    ['frontmatter id (dirname IS the id)', { a: { infer: '---\nid: a\n---\nx\n' } }, /not declared anywhere/],
    ['frontmatter hooks (moved to hooks.yaml)', { a: { infer: '---\nhooks: {}\n---\nx\n' } }, /"hooks" moved to/],
    ['frontmatter unknown key', { a: { infer: '---\nfoo: 1\n---\nx\n' } }, /allows only "clarify"/],
    ['frontmatter non-boolean clarify', { a: { infer: '---\nclarify: maybe\n---\nx\n' } }, /clarify must be true or false/],
    // ── outcomes (decision vocabulary — verdict routing) ──
    ['outcomes with one entry (not a decision)', { a: { infer: '---\noutcomes: [ok]\n---\nx\n' } }, /outcomes must be 2–5 kebab-case ids/],
    ['outcomes over the cap', { a: { infer: '---\noutcomes: [a1, a2, a3, a4, a5, a6]\n---\nx\n' } }, /outcomes must be 2–5 kebab-case ids/],
    ['outcomes with a bad id', { a: { infer: '---\noutcomes: [ok, "Not Valid!"]\n---\nx\n' } }, /outcomes must be 2–5 kebab-case ids/],
    ['duplicate outcomes', { a: { infer: '---\noutcomes: [ok, ok]\n---\nx\n' } }, /outcomes must be unique/],
    // ── hooks.yaml (H1–H6 intra-file + file shape) ──
    ['hooks.yaml without the hooks wrapper key', { a: { hooks: { stop: [{ artifact: 'r.md' }] } } }, /exactly one top-level "hooks" key/],
    ['hooks.yaml with an extra top-level key', { a: { hooks: { hooks: { stop: [{ artifact: 'r.md' }] }, extra: 1 } } }, /exactly one top-level "hooks" key/],
    ['hooks as a list, not a mapping', { a: { hooks: { hooks: [{ artifact: 'r.md' }] } } }, /hooks must be a mapping/],
    ['unknown hook event key', { a: { hooks: { hooks: { preTool: [{ action: 'read_file' }] } } } }, /unknown event/],
    ['empty stop list', { a: { hooks: { hooks: { stop: [] } } } }, /non-empty list/],
    ['stop list over the cap', { a: { hooks: { hooks: { stop: Array.from({ length: 9 }, (_, i) => ({ artifact: `f${i}.md` })) } } } }, /cap is 8/],
    ['entry with both artifact and action', { a: { hooks: { hooks: { stop: [{ artifact: 'r.md', action: 'read_file' }] } } } }, /exactly one of "artifact" \| "action"/],
    ['entry with an extra key', { a: { hooks: { hooks: { stop: [{ artifact: 'r.md', when: 'always' }] } } } }, /exactly one of "artifact" \| "action"/],
    ['duplicate hook entries', { a: { hooks: { hooks: { stop: [{ artifact: 'r.md' }, { artifact: 'r.md' }] } } } }, /duplicate entry/],
    ['artifact glob over 200 chars', { a: { hooks: { hooks: { stop: [{ artifact: 'x'.repeat(201) }] } } } }, /exceeds 200/],
    ['artifact traversal segment', { a: { hooks: { hooks: { stop: [{ artifact: '../escape.md' }] } } } }, /"\.\." path segment/],
    ['artifact leading slash', { a: { hooks: { hooks: { stop: [{ artifact: '/abs.md' }] } } } }, /no leading \//],
    ['artifact backslash separator', { a: { hooks: { hooks: { stop: [{ artifact: 'reports\\r.md' }] } } } }, /posix separators/],
    ['artifact under sessions/', { a: { hooks: { hooks: { stop: [{ artifact: 'sessions/**/x.json' }] } } } }, /reserved, non-writable/],
    ['artifact charset violation', { a: { hooks: { hooks: { stop: [{ artifact: 'reports/{week}.md' }] } } } }, /characters outside/],
    ['** glued into a segment', { a: { hooks: { hooks: { stop: [{ artifact: 'a**b/x.md' }] } } } }, /whole path segment/],
    ['action neither builtin nor mcp', { a: { hooks: { hooks: { stop: [{ action: 'frobnicate' }] } } } }, /neither a universal builtin/],
    ['action clarify (control tool, outside the preset)', { a: { hooks: { hooks: { stop: [{ action: 'clarify' }] } } } }, /neither a universal builtin/],
    ['action malformed mcp name (uppercase server)', { a: { hooks: { hooks: { stop: [{ action: 'mcp__Server__tool' }] } } } }, /neither a universal builtin/],
  ] as const)('%s → throws', (_label, intentDirs, pattern) => {
    setup(intentDirs as IntentFiles);
    expect(() => loadCustomJob(roots(), 'ops', 'weekly')).toThrow(pattern);
  });

  it.each([
    ['intent dir missing infer.md', (agentDir: string) => {
      fs.mkdirSync(path.join(agentDir, 'jobs', 'weekly', 'intents', 'b'), { recursive: true });
    }, /missing its required infer\.md/],
    ['leftover intent.yaml inside an intent dir', (agentDir: string) => {
      fs.writeFileSync(path.join(agentDir, 'jobs', 'weekly', 'intents', 'a', 'intent.yaml'), 'id: a\ndescription: x\n');
    }, /intent\.yaml was replaced by infer\.md/],
    ['unknown file inside an intent dir (typo hook.yaml)', (agentDir: string) => {
      fs.writeFileSync(path.join(agentDir, 'jobs', 'weekly', 'intents', 'a', 'hook.yaml'), 'hooks:\n  stop:\n    - artifact: r.md\n');
    }, /unexpected entry "hook\.yaml"/],
    ['stray non-directory entry under intents/', (agentDir: string) => {
      fs.writeFileSync(path.join(agentDir, 'jobs', 'weekly', 'intents', 'notes.md'), 'stray');
    }, /stray file "notes\.md"/],
    ['invalid intent directory name', (agentDir: string) => {
      const dir = path.join(agentDir, 'jobs', 'weekly', 'intents', 'Bad_Dir');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'infer.md'), 'x\n');
    }, /not a valid intent id/],
  ] as const)('%s → throws', (_label, mutate, pattern) => {
    const agentDir = setup({ a: {} });
    mutate(agentDir);
    expect(() => loadCustomJob(roots(), 'ops', 'weekly')).toThrow(pattern);
  });

  it('outcomes frontmatter loads onto the intent def (verdict vocabulary)', () => {
    setup({ a: { infer: '---\noutcomes: [ok, anomaly, needs-review]\n---\napplies when judging\n' } });
    const { intents } = loadCustomJob(roots(), 'ops', 'weekly');
    expect(intents[0].outcomes).toEqual(['ok', 'anomaly', 'needs-review']);
  });

  it('comments-only hooks.yaml → intent loads with no hooks (delete-equivalent)', () => {
    setup({ a: { hooks: '# no contract yet\n' } });
    const { intents } = loadCustomJob(roots(), 'ops', 'weekly');
    expect(intents[0].hooks).toBeUndefined();
  });

  it('comments-only frontmatter is valid — guidance comments never reach the criterion', () => {
    setup({ a: { infer: '---\n# authoring guidance lives here\n---\nApplies when the user asks for x.\n' } });
    const { intents } = loadCustomJob(roots(), 'ops', 'weekly');
    expect(intents[0].infer).toBe('Applies when the user asks for x.');
    expect(intents[0].clarify).toBeUndefined();
  });

  it('prompt.md preloads into intentPrompts and flags hasPrompt', () => {
    setup({
      a: { prompt: 'Prompt body.\n' },
      b: {},
      c: { prompt: '   \n' }, // whitespace-only = absent (empty-file create is harmless)
    });
    const resolved = loadCustomJob(roots(), 'ops', 'weekly');
    expect(resolved.intentPrompts).toEqual({ a: 'Prompt body.\n' });
    expect(resolved.intents.map((i) => i.hasPrompt)).toEqual([true, undefined, undefined]);
  });

  it('catalog order is the sorted intent-directory order (deterministic)', () => {
    setup({
      zebra: { infer: 'z\n' },
      alpha: { infer: 'a\n' },
      mid: { infer: 'm\n' },
    });
    expect(loadCustomJob(roots(), 'ops', 'weekly').intents.map((i) => i.id)).toEqual(['alpha', 'mid', 'zebra']);
  });

  it('catalog cap (32) is enforced over the aggregate', () => {
    const many: IntentFiles = Object.fromEntries(
      Array.from({ length: 33 }, (_, i) => [`intent-${i}`, {}]),
    );
    setup(many);
    expect(() => loadCustomJob(roots(), 'ops', 'weekly')).toThrow(/cap is 32/);
  });

  it('discovery projects the job catalog into CustomJobSummary.intents (lenient)', () => {
    setup({ a: { infer: 'job-a\n' } });
    const agents = discoverAgents(roots());
    expect(agents[0].jobs[0].intents).toEqual([{ id: 'a', infer: 'job-a' }]);
  });

  it('discovery carries the FULL intent defs — hooks/clarify/hasPrompt reach the summary', () => {
    // The actions-tab detail view renders off the discovery summary, so the
    // projection must not strip fields (the historical {id, infer} map).
    setup({
      a: {
        infer: '---\nclarify: false\n---\njob-a\n',
        prompt: 'Guide body.\n',
        hooks: { hooks: { stop: [{ artifact: 'reports/*-weekly.md' }] } },
      },
    });
    const agents = discoverAgents(roots());
    expect(agents[0].jobs[0].intents).toEqual([
      { id: 'a', infer: 'job-a', clarify: false,
        hooks: { stop: [{ artifact: 'reports/*-weekly.md' }] }, hasPrompt: true },
    ]);
  });

  it('discovery omits intents (not []) when the catalog is malformed', () => {
    setup({ a: { infer: '---\nnope: 1\n---\nx\n' } });
    const agents = discoverAgents(roots());
    expect(agents[0].jobs[0].intents).toBeUndefined();
  });
});

describe('loadCustomJob — stop hooks (H7/H8 cross-file + happy path)', () => {
  function setupHookJob(jobYaml: Record<string, unknown>, hooksDoc: Record<string, unknown>): void {
    const agentDir = writeAgent(roots()[0].root, 'ops', {}, { base: { 'system.md': 'Persona.' } });
    writeJob(agentDir, 'weekly', jobYaml);
    writeIntent(agentDir, 'weekly', 'a', { hooks: { hooks: hooksDoc } });
  }

  it('valid hooks survive the load (artifact + builtin action + mcp action)', () => {
    setupHookJob(
      { mcp: { servers: { 'ops-api': { transport: 'http', url: 'http://127.0.0.1:8931/mcp' } } } },
      { stop: [
        { artifact: 'reports/**/*.md' },
        { action: 'create_file' },
        { action: 'mcp__ops-api__create_incident' },
      ] },
    );
    const { intents } = loadCustomJob(roots(), 'ops', 'weekly');
    expect(intents[0].hooks).toEqual({ stop: [
      { artifact: 'reports/**/*.md' },
      { action: 'create_file' },
      { action: 'mcp__ops-api__create_incident' },
    ] });
  });

  it('H7: artifact hook with no write tool in tools.builtin → throws', () => {
    setupHookJob(
      { tools: { builtin: ['read_file', 'list_files'] } },
      { stop: [{ artifact: 'reports/*.md' }] },
    );
    expect(() => loadCustomJob(roots(), 'ops', 'weekly')).toThrow(/no artifact-write tool/);
  });

  it('H8: builtin action outside tools.builtin → throws', () => {
    setupHookJob(
      { tools: { builtin: ['read_file'] } },
      { stop: [{ action: 'create_file' }] },
    );
    expect(() => loadCustomJob(roots(), 'ops', 'weekly')).toThrow(/not in this job's tools\.builtin/);
  });

  it('H8: mcp action whose server is not declared → throws', () => {
    setupHookJob({}, { stop: [{ action: 'mcp__ghost__do-thing' }] });
    expect(() => loadCustomJob(roots(), 'ops', 'weekly')).toThrow(/no MCP server "ghost"/);
  });

  it('H8: api action satisfied by a declared apis entry; undeclared server → throws', () => {
    setupHookJob(
      { apis: { erp: { baseUrl: 'https://erp.example.com/api' } } },
      { stop: [{ action: 'api__erp__request' }] },
    );
    expect(loadCustomJob(roots(), 'ops', 'weekly').intents[0].hooks?.stop).toEqual([
      { action: 'api__erp__request' },
    ]);

    setupHookJob({}, { stop: [{ action: 'api__ghost__request' }] });
    expect(() => loadCustomJob(roots(), 'ops', 'weekly')).toThrow(/no API server "ghost"/);
  });

  it('H8: mcp action satisfied by an AGENT-declared server (merged view)', () => {
    const agentDir = writeAgent(
      roots()[0].root,
      'ops',
      { mcp: { servers: { 'ops-api': { transport: 'http', url: 'http://127.0.0.1:8931/mcp' } } } },
      { base: { 'system.md': 'Persona.' } },
    );
    writeJob(agentDir, 'weekly', {});
    writeIntent(agentDir, 'weekly', 'a', {
      hooks: { hooks: { stop: [{ action: 'mcp__ops-api__list_incidents' }] } },
    });
    expect(loadCustomJob(roots(), 'ops', 'weekly').intents[0].hooks?.stop).toHaveLength(1);
  });

  // H9 — the glob and the procedure must name the same path family. An
  // unpaired artifact hook is an ADVISORY (surfaced at save/validate), never
  // a load failure: an agent that already runs must stay loadable.
  const h9Cases: Array<[string, string | undefined, string, string | null]> = [
    // [case, prompt body, glob, expected advisory substring (null = clean)]
    ['prompt names a path under the glob dir → clean', '결과를 `reports/{약관코드}.md`로 저장한다.', 'reports/*.md', null],
    ['prompt never names the glob dir → advisory', 'Summarize the findings in your reply.', 'reports/*.md', 'never names a path'],
    // Absent prompt gets save-order-aware wording, not "add an output step":
    // in a parallel save batch hooks.yaml can land before prompt.md, and a
    // spurious repair instruction sends the author fixing an in-flight file.
    ['no prompt.md at all → save-order advisory', undefined, 'reports/*.md', 'has no prompt.md yet'],
    ['glob with no static prefix (*.md) → skipped', 'Reply with a table.', '*.md', null],
    ['fully literal glob named verbatim → clean', 'Write `runs/manifest.md` last.', 'runs/manifest.md', null],
    ['fully literal glob absent from prompt → advisory', 'Reply only.', 'runs/manifest.md', 'never names a path'],
    ['deep static prefix checked as a whole → advisory', 'Files go under `reports/`.', 'reports/2026/**', 'never names a path'],
  ];
  it.each(h9Cases)('H9: %s', (_name, prompt, glob, expectedAdvisory) => {
    const agentDir = writeAgent(roots()[0].root, 'ops', {}, { base: { 'system.md': 'Persona.' } });
    writeJob(agentDir, 'weekly', {});
    writeIntent(agentDir, 'weekly', 'a', {
      ...(prompt !== undefined ? { prompt } : {}),
      hooks: { hooks: { stop: [{ artifact: glob }] } },
    });
    const resolved = loadCustomJob(roots(), 'ops', 'weekly');
    if (expectedAdvisory) {
      expect(resolved.advisories).toHaveLength(1);
      expect(resolved.advisories?.[0]).toContain(glob);
      expect(resolved.advisories?.[0]).toContain(expectedAdvisory);
    } else {
      expect(resolved.advisories).toBeUndefined();
    }
  });
});

describe('loadCustomJob — clarify knob (agent / job / intent)', () => {
  it.each([
    // [label, agentClarify, jobClarify, expectedDefault]
    ['default enabled when undeclared', undefined, undefined, true],
    ['agent false → false', false, undefined, false],
    ['agent true → true', true, undefined, true],
    ['job false wins over agent true', true, false, false],
    ['job true wins over agent false', false, true, true],
  ] as const)('clarifyDefault precedence: %s', (_label, agentClarify, jobClarify, expected) => {
    const dir = writeAgent(roots()[0].root, 'ops', agentClarify !== undefined ? { clarify: agentClarify } : {});
    writeJob(dir, 'weekly', jobClarify !== undefined ? { clarify: jobClarify } : {});
    expect(loadCustomJob(roots(), 'ops', 'weekly').clarifyDefault).toBe(expected);
  });

  it.each([
    ['agent.yaml string knob', { agent: { clarify: 'yes' } }],
    ['agent.yaml numeric knob', { agent: { clarify: 1 } }],
    ['job.yaml string knob', { job: { clarify: 'false' } }],
    ['job.yaml numeric knob', { job: { clarify: 0 } }],
  ] as const)('non-boolean %s → validation error stating the unattended semantic', (_label, cfg: any) => {
    const dir = writeAgent(roots()[0].root, 'ops', cfg.agent ?? {});
    writeJob(dir, 'weekly', cfg.job ?? {});
    expect(() => loadCustomJob(roots(), 'ops', 'weekly')).toThrow(/autonomous\/unattended/);
  });

  it('intent-level non-boolean knob → validation error stating the unattended semantic', () => {
    const dir = writeAgent(roots()[0].root, 'ops', {});
    writeJob(dir, 'weekly', {});
    writeIntent(dir, 'weekly', 'a', { infer: '---\nclarify: maybe\n---\nx\n' });
    expect(() => loadCustomJob(roots(), 'ops', 'weekly')).toThrow(/autonomous\/unattended/);
  });

  // @ant/shared contract regression: CustomIntentDef.clarify round-trips the loader.
  it('intent-level boolean knob round-trips into CustomIntentDef.clarify', () => {
    const dir = writeAgent(roots()[0].root, 'ops', {});
    writeJob(dir, 'weekly', {});
    writeIntent(dir, 'weekly', 'a', { infer: '---\nclarify: false\n---\nx\n' });
    writeIntent(dir, 'weekly', 'b', { infer: '---\nclarify: true\n---\ny\n' });
    writeIntent(dir, 'weekly', 'c', { infer: 'z\n' });
    const { intents } = loadCustomJob(roots(), 'ops', 'weekly');
    expect(intents.find((i) => i.id === 'a')?.clarify).toBe(false);
    expect(intents.find((i) => i.id === 'b')?.clarify).toBe(true);
    expect(intents.find((i) => i.id === 'c')?.clarify).toBeUndefined();
  });
});

describe('gateDefinitionSave — per-file byte budget', () => {
  // The 100kb pre-auth parser used to shadow this funnel; once the full-size
  // parser is reachable, the funnel must carry its own budget.
  it('refuses a file over DEFINITION_FILE_MAX_BYTES with 413', () => {
    const gate = gateDefinitionSave('ops', 'on-demand/spec.md', 'x'.repeat(DEFINITION_FILE_MAX_BYTES + 1));
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.status).toBe(413);
  });

  it('accepts a file exactly at the budget', () => {
    const gate = gateDefinitionSave('ops', 'on-demand/spec.md', 'x'.repeat(DEFINITION_FILE_MAX_BYTES));
    expect(gate.ok).toBe(true);
  });

  it('measures serialized bytes, not characters (multibyte content)', () => {
    // 3 bytes per char in UTF-8 — a character count under the cap must still refuse.
    const gate = gateDefinitionSave('ops', 'on-demand/spec.md', '\u{AC00}'.repeat(Math.ceil(DEFINITION_FILE_MAX_BYTES / 3) + 1));
    expect(gate.ok).toBe(false);
  });

  // A Unicode escape that lost its backslash leaves the four hex digits as
  // literal prose and drops the character they stood for. Observed live as
  // `평ubc84vs` in an authored Korean procedure: well-formed, saved clean, and
  // unreadable by the agent that later runs it. Adjacency to non-ASCII is what
  // makes it safe to refuse — a word boundary separates real text from a real
  // identifier.
  it.each([
    ['bare escape wedged after Hangul', '- 정산서 수치(평ubc84vs 항목 포함)', false],
    ['bare escape before Hangul', '- ubc84평가 기준', false],
    ['backslash form anywhere', '- 텍스트 \\ubc84 남음', false],
    ['ordinary Korean prose', '- 담당자가 화면에서 내려받은 자료를 전달한다', true],
    ['ascii identifier with digits', '- use menu1234 for the list', true],
    ['secret reference', '- `${secret:JIRA_API_TOKEN}`', true],
    ['business-key path beside Hangul', '- outputs/data-prep-{정산대상월}.md', true],
    ['too few hex digits', '- value u12 짧음', true],
    ['windows path', '- C:\\Users\\probe', true],
    ['uuid beside Hangul', '- uuid를 쓴다', true],
    // More of the escape eaten: `\uBA74` for 면 came back as "일치하a74" —
    // three hex digits, no `u`, welded to the preceding syllable
    // (fern-camping-prowl). A codepoint's hex mixes digits and a-f, which is
    // what separates it from the strings that must still save.
    ['hex residue after Hangul', '- 금액이 일치하a74 반대계정을 지정한다', false],
    ['four-digit residue', '- 값을 하c99d 확인한다', false],
    ['uppercase model name', '- 삼성A74 단말 목록', true],
    ['non-hex model name', '- 갤럭시S23 출시분', true],
    ['letters only, no digit', '- 테스트abc 케이스', true],
    ['digits only, no a-f', '- 금액 123 원', true],
    ['hex-looking word', '- 테스트deed 값', true],
  ])('%s → ok=%s', (_label, content, ok) => {
    const gate = gateDefinitionSave('ops', 'on-demand/spec.md', content);
    expect(gate.ok).toBe(ok);
    if (!gate.ok) expect(gate.status).toBe(400);
  });

  // An outcome naming the clarify exit is refused at SAVE only — the loader
  // shares validateInferFile, so a definition already carrying one keeps loading.
  const INFER = (outcomes: string) => `---\noutcomes: [${outcomes}]\n---\napplies when judging\n`;
  it.each([
    ['needs-clarification', 'thirty-day, seven-day, needs-clarification', false],
    ['insufficient-input', 'schedule-produced, insufficient-input', false],
    ['missing-input', 'ok, anomaly, missing-input', false],
    ['input-required', 'ok, anomaly, input-required', false],
    // a missing FINDING is a real verdict — the rule must not reach it
    ['insufficient-evidence passes', 'compliant, insufficient-evidence', true],
    ['ordinary vocabulary passes', 'thirty-day, seven-day, one-month', true],
  ])('gates outcomes: %s', (_label, outcomes, shouldPass) => {
    const gate = gateDefinitionSave('ops', 'jobs/notice/intents/assess/infer.md', INFER(outcomes));
    expect(gate.ok).toBe(shouldPass);
    if (!gate.ok) {
      expect(gate.status).toBe(400);
      expect(gate.error).toMatch(/clarify exit, not a verdict/);
    }
  });
});
