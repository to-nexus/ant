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
    injections?: Record<string, string>;
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

  it('job builtin outside the universal preset → throws', () => {
    const dir = writeAgent(roots()[0].root, 'ops', {});
    writeJob(dir, 'weekly', { tools: { builtin: ['search_code'] } });
    expect(() => loadCustomJob(roots(), 'ops', 'weekly')).toThrow(/universal preset/);
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

  it('agent-level injections/*.md on disk → throws move instruction', () => {
    const dir = writeAgent(roots()[0].root, 'ops', {});
    writeJob(dir, 'weekly', {});
    fs.mkdirSync(path.join(dir, 'injections'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'injections', 'style.md'), 'Legacy prose.');
    expect(() => loadCustomJob(roots(), 'ops', 'weekly')).toThrow(/Agent-level injections\/ is no longer supported/);
  });

  it('an empty legacy injections/ dir is tolerated (no *.md left)', () => {
    const dir = writeAgent(roots()[0].root, 'ops', {});
    writeJob(dir, 'weekly', {});
    fs.mkdirSync(path.join(dir, 'injections'), { recursive: true });
    expect(loadCustomJob(roots(), 'ops', 'weekly').jobId).toBe('weekly');
  });
});

describe('loadCustomJob — composition (job-only tools/injections, mcp union)', () => {
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
        tools: { builtin: ['read_file', 'create_file'], approval: { fetch_url: 'always', create_file: 'always' } },
        mcp: { servers: { jobonly: { transport: 'http', url: 'http://localhost:9' } } },
      },
      {
        base: { 'system.md': 'JOB PROCEDURE' },
        injections: { 'job-only.md': 'Job conditional' },
      },
    );

    const resolved = loadCustomJob(roots(), 'ops', 'weekly');

    // prose: agent base before job base
    expect(resolved.prose.indexOf('AGENT PERSONA')).toBeLessThan(resolved.prose.indexOf('JOB PROCEDURE'));
    // injections: job-only
    expect(resolved.injectionsToc.map((e) => e.file)).toEqual(['job-only.md']);
    // mcp union (the one field that still composes agent ∪ job)
    expect(Object.keys(resolved.mcpServers).sort()).toEqual(['jobonly', 'shared']);
    // builtin = the job's declaration
    expect(resolved.builtinTools.sort()).toEqual(['create_file', 'read_file']);
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

// ── intents.yaml (job-only single-file catalog, D-A) ─────────────────────────

describe('loadCustomJob — intents catalog validation table', () => {
  function setup(jobIntents?: unknown, opts?: {
    jobInjections?: Record<string, string>;
  }): void {
    const agentDir = writeAgent(roots()[0].root, 'ops', {}, {
      base: { 'system.md': 'Persona.' },
    });
    writeJob(agentDir, 'weekly', {}, { injections: opts?.jobInjections });
    if (jobIntents !== undefined) {
      const jobDir = path.join(agentDir, 'jobs', 'weekly');
      fs.writeFileSync(
        path.join(jobDir, 'intents.yaml'),
        typeof jobIntents === 'string' ? jobIntents : yaml.dump(jobIntents),
      );
    }
  }

  it('absent file → empty catalog (detect zero-cost path)', () => {
    setup();
    expect(loadCustomJob(roots(), 'ops', 'weekly').intents).toEqual([]);
  });

  it('comments-only / empty intents list → empty catalog', () => {
    setup('# just comments\n');
    expect(loadCustomJob(roots(), 'ops', 'weekly').intents).toEqual([]);
    setup({ version: 1, intents: [] });
    expect(loadCustomJob(roots(), 'ops', 'weekly').intents).toEqual([]);
  });

  it.each([
    ['duplicate id in one file', { intents: [
      { id: 'a', description: 'x' }, { id: 'a', description: 'y' },
    ] }, /duplicate intent id/],
    ['reserved general id', { intents: [{ id: 'general', description: 'x' }] }, /implicit fallback/],
    ['bad id charset', { intents: [{ id: 'Bad_Id', description: 'x' }] }, /must match/],
    ['empty description', { intents: [{ id: 'a', description: '  ' }] }, /non-empty description/],
    ['description over 200 chars', { intents: [{ id: 'a', description: 'x'.repeat(201) }] }, /exceeds 200/],
    ['injection with path separator', { intents: [{ id: 'a', description: 'x', injections: ['dir/f.md'] }] }, /bare file name/],
    ['injection without .md', { intents: [{ id: 'a', description: 'x', injections: ['f.txt'] }] }, /must be a \.md file/],
    ['missing injection file', { intents: [{ id: 'a', description: 'x', injections: ['ghost.md'] }] }, /does not exist/],
  ] as const)('%s → throws', (_label, doc, pattern) => {
    setup(doc);
    expect(() => loadCustomJob(roots(), 'ops', 'weekly')).toThrow(pattern);
  });

  it('catalog cap (32) is enforced per file', () => {
    const many = Array.from({ length: 33 }, (_, i) => ({ id: `intent-${i}`, description: 'x' }));
    setup({ intents: many });
    expect(() => loadCustomJob(roots(), 'ops', 'weekly')).toThrow(/cap is 32/);
  });

  it('TOC annotation: mapped entries carry intents[] + preloaded body; unmapped drop body', () => {
    setup(
      { intents: [{ id: 'a', description: 'x', injections: ['mapped.md'] }] },
      { jobInjections: { 'mapped.md': 'Mapped body text.', 'unmapped.md': 'Unmapped body.' } },
    );
    const { injectionsToc } = loadCustomJob(roots(), 'ops', 'weekly');
    const mapped = injectionsToc.find((e) => e.file === 'mapped.md');
    const unmapped = injectionsToc.find((e) => e.file === 'unmapped.md');
    expect(mapped?.intents).toEqual(['a']);
    expect(mapped?.body).toBe('Mapped body text.');
    expect(unmapped?.intents).toBeUndefined();
    expect(unmapped?.body).toBeUndefined();
  });

  it('discovery projects the job catalog into CustomJobSummary.intents (lenient)', () => {
    setup({ intents: [{ id: 'a', description: 'job-a' }] });
    const agents = discoverAgents(roots());
    expect(agents[0].jobs[0].intents).toEqual([{ id: 'a', description: 'job-a' }]);
  });

  it('discovery omits intents (not []) when the catalog is malformed', () => {
    setup('intents: [ {{{ broken');
    const agents = discoverAgents(roots());
    expect(agents[0].jobs[0].intents).toBeUndefined();
  });
});
