/**
 * Custom agent/job loader — validation table + D4 merge rules + D8 scope
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

let tmpRoot: string;

function writeAgent(
  root: string,
  agentId: string,
  agentYaml: Record<string, unknown>,
  opts?: {
    base?: Record<string, string>;
    injections?: Record<string, string>;
  },
): string {
  const agentDir = path.join(root, agentId);
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(path.join(agentDir, 'agent.yaml'), yaml.dump({ id: agentId, name: agentId, description: '', ...agentYaml }));
  for (const [file, content] of Object.entries(opts?.base ?? {})) {
    fs.mkdirSync(path.join(agentDir, 'base'), { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'base', file), content);
  }
  for (const [file, content] of Object.entries(opts?.injections ?? {})) {
    fs.mkdirSync(path.join(agentDir, 'injections'), { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'injections', file), content);
  }
  return agentDir;
}

function writeJob(
  agentDir: string,
  jobId: string,
  jobYaml: Record<string, unknown>,
  opts?: {
    base?: Record<string, string>;
    injections?: Record<string, string>;
  },
): void {
  const jobDir = path.join(agentDir, 'jobs', jobId);
  fs.mkdirSync(jobDir, { recursive: true });
  fs.writeFileSync(path.join(jobDir, 'job.yaml'), yaml.dump({ id: jobId, name: jobId, description: '', ...jobYaml }));
  const base = opts?.base ?? { 'system.md': 'Job procedure.' };
  for (const [file, content] of Object.entries(base)) {
    fs.mkdirSync(path.join(jobDir, 'base'), { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'base', file), content);
  }
  for (const [file, content] of Object.entries(opts?.injections ?? {})) {
    fs.mkdirSync(path.join(jobDir, 'injections'), { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'injections', file), content);
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

  it('job builtin outside agent bound → throws (narrowing only)', () => {
    const dir = writeAgent(roots()[0].root, 'ops', { tools: { builtin: ['read_file'] } });
    writeJob(dir, 'weekly', { tools: { builtin: ['read_file', 'run_command'] } });
    expect(() => loadCustomJob(roots(), 'ops', 'weekly')).toThrow(/narrowing only/);
  });

  it('agent builtin outside the universal preset → throws', () => {
    const dir = writeAgent(roots()[0].root, 'ops', { tools: { builtin: ['search_code'] } });
    writeJob(dir, 'weekly', {});
    expect(() => loadCustomJob(roots(), 'ops', 'weekly')).toThrow(/universal preset/);
  });

  it('outputs contract without a write tool → throws', () => {
    const dir = writeAgent(roots()[0].root, 'ops', {});
    writeJob(dir, 'weekly', {
      tools: { builtin: ['read_file'] },
      outputs: { mode: 'contract', artifacts: [{ kind: 'report', dir: 'reports/', format: 'md', naming: 'llm' }] },
    });
    expect(() => loadCustomJob(roots(), 'ops', 'weekly')).toThrow(/requires a write tool/);
  });

  it('outputs contract without artifacts → throws', () => {
    const dir = writeAgent(roots()[0].root, 'ops', {});
    writeJob(dir, 'weekly', { outputs: { mode: 'contract' } });
    expect(() => loadCustomJob(roots(), 'ops', 'weekly')).toThrow(/at least one artifacts entry/);
  });

  it('mcp env carrying a literal value (not an env var NAME) → throws', () => {
    const dir = writeAgent(roots()[0].root, 'ops', {
      mcp: { servers: { db: { transport: 'stdio', command: 'npx', env: { DB_URL: 'postgres://user:pw@host' } } } },
    });
    writeJob(dir, 'weekly', {});
    expect(() => loadCustomJob(roots(), 'ops', 'weekly')).toThrow(/env var NAME/);
  });

  it('mcp stdio without command / http without url → throws', () => {
    const dir = writeAgent(roots()[0].root, 'ops', { mcp: { servers: { a: { transport: 'stdio' } } } });
    writeJob(dir, 'weekly', {});
    expect(() => loadCustomJob(roots(), 'ops', 'weekly')).toThrow(/requires "command"/);

    const dir2 = writeAgent(roots()[0].root, 'ops2', { mcp: { servers: { b: { transport: 'http' } } } });
    writeJob(dir2, 'weekly', {});
    expect(() => loadCustomJob(roots(), 'ops2', 'weekly')).toThrow(/requires "url"/);
  });
});

describe('loadCustomJob — D4 merge rules', () => {
  it('merges agent → job (prose order, injections union job-wins, mcp union, approval stricter-wins, models override)', () => {
    const dir = writeAgent(
      roots()[0].root,
      'ops',
      {
        tools: { builtin: ['read_file', 'create_file', 'edit_file', 'fetch_url'], approval: { fetch_url: 'always' } },
        mcp: { servers: { shared: { transport: 'stdio', command: 'npx' } } },
        models: { agent: 'claude-sonnet-5', default: 'claude-sonnet-5' },
        workspace: 'read',
      },
      {
        base: { 'a-persona.md': 'AGENT PERSONA' },
        injections: { 'shared.md': 'Shared conditional', 'both.md': 'agent version' },
      },
    );
    writeJob(
      dir,
      'weekly',
      {
        tools: { builtin: ['read_file', 'create_file'], approval: { fetch_url: 'never', create_file: 'always' } },
        mcp: { servers: { jobonly: { transport: 'http', url: 'http://localhost:9' } } },
        models: { agent: 'claude-opus-5' },
      },
      {
        base: { 'system.md': 'JOB PROCEDURE' },
        injections: { 'both.md': 'job version', 'job-only.md': 'Job conditional' },
      },
    );

    const resolved = loadCustomJob(roots(), 'ops', 'weekly');

    // prose: agent base before job base
    expect(resolved.prose.indexOf('AGENT PERSONA')).toBeLessThan(resolved.prose.indexOf('JOB PROCEDURE'));
    // injections: union, job wins on filename collision
    const both = resolved.injectionsToc.find((e) => e.file === 'both.md')!;
    expect(both.summary).toBe('job version');
    expect(resolved.injectionsToc.map((e) => e.file).sort()).toEqual(['both.md', 'job-only.md', 'shared.md']);
    // mcp union
    expect(Object.keys(resolved.mcpServers).sort()).toEqual(['jobonly', 'shared']);
    // builtin narrowed to job's subset
    expect(resolved.builtinTools.sort()).toEqual(['create_file', 'read_file']);
    // approval: stricter (always) wins over the job's attempt to relax
    expect(resolved.approval.fetch_url).toBe('always');
    expect(resolved.approval.create_file).toBe('always');
    // models: job overrides agent
    expect(resolved.models.agent).toBe('claude-opus-5');
    expect(resolved.models.default).toBe('claude-sonnet-5');
    // workspace inherited from agent
    expect(resolved.workspace).toBe('read');
  });

  it('agent without tools.builtin defaults the bound to the full preset', () => {
    const dir = writeAgent(roots()[0].root, 'ops', {});
    writeJob(dir, 'weekly', { tools: { builtin: ['run_command'] } });
    const resolved = loadCustomJob(roots(), 'ops', 'weekly');
    expect(resolved.builtinTools).toEqual(['run_command']);
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
    ['builtin-only id → creatable (shadowing allowed)', 2, null],
    ['org id → creatable (readonly scopes never block)', 1, null],
    ['user id → blocks', 0, 'user'],
  ] as const)('findCreateCollision: %s', (_label, rootIdx, expected) => {
    writeAgent(roots()[rootIdx].root, 'dup', {});
    const collision = findCreateCollision(roots(), 'dup');
    if (expected === null) {
      expect(collision).toBeNull();
    } else {
      expect(collision!.scopeRoot.scope).toBe(expected);
    }
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
