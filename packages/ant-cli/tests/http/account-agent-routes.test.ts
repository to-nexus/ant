/**
 * Account-scoped agent settings routes (`/api/definitions/agents`) — CRUD,
 * readonly-scope 403s, and the definition-file endpoint table (single write
 * funnel: 400 gates vs 200-with-warnings semantic validation, traversal
 * guard, whitelist, structural-file protection, folder import).
 *
 * No supertest: real Express app + node:http on port 0, called via fetch
 * (mirrors tests/http/files-routes-feature-slug.test.ts). The resolver is a
 * minimal fake — these routes only consume `getWorkspacePath(userContext)`.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import http from 'node:http';
import express from 'express';
import * as yaml from 'js-yaml';
import { createAccountAgentRoutes } from '../../src/periphery/adapters/http/routes/accountAgents.routes';
import { createSelfApiScopeGuard } from '../../src/periphery/adapters/http/middleware/selfApiScopeGuard';
import type { WorkspaceResolver } from '../../src/core/config/WorkspacePathResolver';
import type { OrganizationRepositoryPort } from '../../src/core/ports/organizationRepository';
import { getDefinitionDirPolicy, type OrgMembershipRole } from '@ant/shared';
import { zipEntryNames } from './helpers/zipEntries';

let wsRoot: string;
let userDir: string;
let server: http.Server;
let baseUrl: string;

function api(pathname: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}/api/definitions/agents${pathname}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

/** Fake org repo — only the two reads the agent routes perform. */
function fakeOrgRepo(memberships: Map<string, OrgMembershipRole>, orgId = 'acme'): OrganizationRepositoryPort {
  return {
    getOrganization: async (id: string) =>
      id === orgId
        ? ({ id, name: 'Acme', kind: 'team', ownerId: null, createdAt: new Date().toISOString() } as any)
        : null,
    getMembership: async (userId: string, org: string) =>
      org === orgId && memberships.has(userId)
        ? ({ userId, organizationId: org, role: memberships.get(userId)!, createdAt: new Date().toISOString() } as any)
        : null,
  } as unknown as OrganizationRepositoryPort;
}

beforeAll(async () => {
  wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-account-agents-'));
  // Pin the local tenant explicitly — the tenant-aware root derivation now
  // consumes {org, user} plus the physical root, so the layout must be the
  // real `{ws}/{org}/{user}` shape (the fake resolver used to hide this).
  process.env.ANT_LOCAL_ORG = 'localorg';
  process.env.ANT_LOCAL_USER = 'localuser';
  userDir = path.join(wsRoot, 'localorg', 'localuser');
  fs.mkdirSync(userDir, { recursive: true });
  const resolver = {
    getWorkspacePath: () => userDir,
    getPhysicalWorkspacesPath: () => wsRoot,
  } as unknown as WorkspaceResolver;

  const app = express();
  app.use(express.json());
  app.use(
    '/api/definitions/agents',
    createAccountAgentRoutes({ workspaceResolver: resolver, organizationRepository: fakeOrgRepo(new Map()) }),
  );
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  fs.rmSync(wsRoot, { recursive: true, force: true });
  delete process.env.ANT_LOCAL_ORG;
  delete process.env.ANT_LOCAL_USER;
});

beforeEach(() => {
  // Fresh user scope per test (builtin scope stays shared/readonly).
  fs.rmSync(path.join(userDir, '.ant'), { recursive: true, force: true });
});

async function createAgent(id = 'ops'): Promise<void> {
  const res = await api('', { method: 'POST', body: JSON.stringify({ id, name: id }) });
  expect(res.status).toBe(201);
}

describe('listing + CRUD', () => {
  it('GET / returns agents + builtinToolPreset + mutatingBuiltinTools (form vocabulary from the runtime SSOT)', async () => {
    const res = await api('');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.agents)).toBe(true);
    expect(body.builtinToolPreset.length).toBeGreaterThan(0);
    expect(body.mutatingBuiltinTools).toEqual(['http_request', 'run_command']);
    // Shipped builtin samples are visible without a project.
    expect(body.agents.some((a: any) => a.scope === 'builtin')).toBe(true);
  });

  it('agent scaffold is intents-free (job-only); job scaffold ships no intents (absent intents/ = empty catalog)', async () => {
    await createAgent();
    expect(fs.existsSync(path.join(userDir, '.ant/agents/ops/intents.yaml'))).toBe(false);
    expect(fs.existsSync(path.join(userDir, '.ant/agents/ops/injections'))).toBe(false);

    const jobRes = await api('/ops/jobs', { method: 'POST', body: JSON.stringify({ id: 'weekly', name: 'Weekly' }) });
    expect(jobRes.status).toBe(201);
    expect(fs.existsSync(path.join(userDir, '.ant/agents/ops/jobs/weekly/job.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(userDir, '.ant/agents/ops/jobs/weekly/intents.yaml'))).toBe(false);
    expect(fs.existsSync(path.join(userDir, '.ant/agents/ops/jobs/weekly/intents'))).toBe(false);

    const patch = await api('/ops/jobs/weekly', { method: 'PATCH', body: JSON.stringify({ description: 'd' }) });
    expect(patch.status).toBe(200);

    const del = await api('/ops/jobs/weekly', { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(fs.existsSync(path.join(userDir, '.ant/agents/ops/jobs/weekly'))).toBe(false);
  });

  it('readonly scope (builtin) mutations → 403', async () => {
    const res = await api('/assistant', { method: 'PATCH', body: JSON.stringify({ name: 'x' }) });
    expect(res.status).toBe(403);
  });

  it('creating a same-id agent over a builtin → 409 (no silent shadowing); duplicate user id → 409', async () => {
    const shadow = await api('', { method: 'POST', body: JSON.stringify({ id: 'assistant', name: 'Mine' }) });
    expect(shadow.status).toBe(409);
    expect((await shadow.json()).error).toMatch(/built-in/);
    expect(fs.existsSync(path.join(userDir, '.ant/agents/assistant'))).toBe(false);

    await createAgent('dup');
    const again = await api('', { method: 'POST', body: JSON.stringify({ id: 'dup', name: 'dup' }) });
    expect(again.status).toBe(409);
    expect((await again.json()).error).toMatch(/already exists/);
  });

  it('unknown agent → 404; invalid id → 400', async () => {
    expect((await api('/ghost', { method: 'DELETE' })).status).toBe(404);
    expect((await api('/Bad_Id', { method: 'DELETE' })).status).toBe(400);
  });

  it('scaffold base prose uses the default names — agent role.md, job system.md', async () => {
    await createAgent();
    expect(fs.existsSync(path.join(userDir, '.ant/agents/ops/base/role.md'))).toBe(true);
    await api('/ops/jobs', { method: 'POST', body: JSON.stringify({ id: 'weekly', name: 'Weekly' }) });
    expect(fs.existsSync(path.join(userDir, '.ant/agents/ops/jobs/weekly/base/system.md'))).toBe(true);
  });
});

/**
 * The id IS the directory name, and it also keys `sessions/{agentId}` and
 * `artifacts/plan/{agentId}` in every universal project of the account — so
 * these rows assert the definition move AND the workspace sweep, plus that a
 * refusal moves nothing at all.
 */
describe('agent id rename', () => {
  /** A universal project carrying session + plan data for `agentId`. */
  function seedUniversalProject(projectId: string, agentId: string): void {
    const project = path.join(userDir, projectId);
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(path.join(project, 'config.json'), JSON.stringify({ projectType: 'universal' }), 'utf-8');
    const sessions = path.join(project, 'universal/sessions', agentId);
    fs.mkdirSync(sessions, { recursive: true });
    fs.writeFileSync(
      path.join(sessions, 'weekly.json'),
      JSON.stringify({ state: { customJobRef: `${agentId}/weekly` } }),
      'utf-8',
    );
    fs.mkdirSync(path.join(project, 'universal/artifacts/plan', agentId, 'weekly'), { recursive: true });
  }

  beforeEach(() => {
    for (const entry of fs.readdirSync(userDir)) {
      if (entry !== '.ant') fs.rmSync(path.join(userDir, entry), { recursive: true, force: true });
    }
  });

  it('moves the definition dir, patches agent.yaml id, and sweeps every universal project', async () => {
    await createAgent();
    seedUniversalProject('proj-a', 'ops');
    seedUniversalProject('proj-b', 'ops');
    // Non-universal projects are skipped, not swept.
    fs.mkdirSync(path.join(userDir, 'canonical-proj'), { recursive: true });
    fs.writeFileSync(
      path.join(userDir, 'canonical-proj/config.json'),
      JSON.stringify({ projectType: 'canonical' }),
      'utf-8',
    );

    const res = await api('/ops/rename', { method: 'POST', body: JSON.stringify({ id: 'ops-team' }) });
    expect(res.status).toBe(200);
    expect((await res.json()).movedProjects.sort()).toEqual(['proj-a', 'proj-b']);

    expect(fs.existsSync(path.join(userDir, '.ant/agents/ops'))).toBe(false);
    expect(fs.readFileSync(path.join(userDir, '.ant/agents/ops-team/agent.yaml'), 'utf-8')).toContain('id: ops-team');

    for (const projectId of ['proj-a', 'proj-b']) {
      const base = path.join(userDir, projectId, 'universal');
      expect(fs.existsSync(path.join(base, 'sessions/ops'))).toBe(false);
      expect(fs.existsSync(path.join(base, 'sessions/ops-team/weekly.json'))).toBe(true);
      expect(fs.existsSync(path.join(base, 'artifacts/plan/ops-team/weekly'))).toBe(true);
      const session = JSON.parse(fs.readFileSync(path.join(base, 'sessions/ops-team/weekly.json'), 'utf-8'));
      expect(session.state.customJobRef).toBe('ops-team/weekly');
    }
  });

  it('an id taken by a builtin → 409 and nothing moves', async () => {
    await createAgent();
    seedUniversalProject('proj-a', 'ops');
    const res = await api('/ops/rename', { method: 'POST', body: JSON.stringify({ id: 'assistant' }) });
    expect(res.status).toBe(409);
    expect(fs.existsSync(path.join(userDir, '.ant/agents/ops'))).toBe(true);
    expect(fs.existsSync(path.join(userDir, 'proj-a/universal/sessions/ops'))).toBe(true);
  });

  it('occupied workspace data at the destination → 409 BEFORE any move', async () => {
    await createAgent();
    seedUniversalProject('proj-a', 'ops');
    // A stale container from a previously deleted agent named `ops-team`.
    fs.mkdirSync(path.join(userDir, 'proj-a/universal/sessions/ops-team'), { recursive: true });

    const res = await api('/ops/rename', { method: 'POST', body: JSON.stringify({ id: 'ops-team' }) });
    expect(res.status).toBe(409);
    expect((await res.json()).conflicts.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(userDir, '.ant/agents/ops'))).toBe(true);
    expect(fs.existsSync(path.join(userDir, 'proj-a/universal/sessions/ops'))).toBe(true);
  });

  it('readonly scope → 403; invalid target id → 400; same id → no-op 200', async () => {
    await createAgent();
    expect((await api('/assistant/rename', { method: 'POST', body: JSON.stringify({ id: 'x' }) })).status).toBe(403);
    const same = await api('/ops/rename', { method: 'POST', body: JSON.stringify({ id: 'ops' }) });
    expect(same.status).toBe(200);
    expect((await same.json()).movedProjects).toEqual([]);
  });

  // Ids are directory names AND are echoed back in `{agentId}/{jobId}` refs and
  // `@intent:` mentions, so the charset is strict kebab-case — not merely
  // "lowercase and hyphens".
  it.each(['Bad_Id', 'ops--team', 'ops-', '-ops', 'Ops'])('non-kebab id %s → 400', async (badId) => {
    await createAgent();
    expect((await api('/ops/rename', { method: 'POST', body: JSON.stringify({ id: badId }) })).status).toBe(400);
    expect((await api('', { method: 'POST', body: JSON.stringify({ id: badId, name: 'x' }) })).status).toBe(400);
    expect((await api('/ops/jobs', { method: 'POST', body: JSON.stringify({ id: badId, name: 'x' }) })).status).toBe(400);
  });
});

/**
 * jobId is the second half of the same axis: a directory name that also keys
 * `sessions/{agentId}/{jobId}.json` and `artifacts/plan/{agentId}/{jobId}`. The
 * rows mirror the agent block — move + sweep, refusal moves nothing — because
 * the two levels are deliberately symmetric.
 */
describe('job id rename', () => {
  function seedUniversalProject(projectId: string, agentId: string, jobId: string): void {
    const project = path.join(userDir, projectId);
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(path.join(project, 'config.json'), JSON.stringify({ projectType: 'universal' }), 'utf-8');
    const sessions = path.join(project, 'universal/sessions', agentId);
    fs.mkdirSync(sessions, { recursive: true });
    fs.writeFileSync(
      path.join(sessions, `${jobId}.json`),
      JSON.stringify({ state: { customJobRef: `${agentId}/${jobId}` } }),
      'utf-8',
    );
    fs.mkdirSync(path.join(project, 'universal/artifacts/plan', agentId, jobId), { recursive: true });
  }

  beforeEach(async () => {
    for (const entry of fs.readdirSync(userDir)) {
      if (entry !== '.ant') fs.rmSync(path.join(userDir, entry), { recursive: true, force: true });
    }
    await createAgent();
    await api('/ops/jobs', { method: 'POST', body: JSON.stringify({ id: 'weekly', name: 'Weekly' }) });
  });

  it('moves the job dir, patches job.yaml id, and sweeps the per-job container data', async () => {
    seedUniversalProject('proj-a', 'ops', 'weekly');

    const res = await api('/ops/jobs/weekly/rename', { method: 'POST', body: JSON.stringify({ id: 'monthly' }) });
    expect(res.status).toBe(200);
    expect((await res.json()).movedProjects).toEqual(['proj-a']);

    expect(fs.existsSync(path.join(userDir, '.ant/agents/ops/jobs/weekly'))).toBe(false);
    expect(fs.readFileSync(path.join(userDir, '.ant/agents/ops/jobs/monthly/job.yaml'), 'utf-8')).toContain('id: monthly');

    const base = path.join(userDir, 'proj-a/universal');
    expect(fs.existsSync(path.join(base, 'sessions/ops/weekly.json'))).toBe(false);
    expect(fs.existsSync(path.join(base, 'artifacts/plan/ops/weekly'))).toBe(false);
    expect(fs.existsSync(path.join(base, 'artifacts/plan/ops/monthly'))).toBe(true);
    const session = JSON.parse(fs.readFileSync(path.join(base, 'sessions/ops/monthly.json'), 'utf-8'));
    expect(session.state.customJobRef).toBe('ops/monthly');
  });

  it('occupied workspace data at the destination → 409 BEFORE any move', async () => {
    seedUniversalProject('proj-a', 'ops', 'weekly');
    fs.writeFileSync(path.join(userDir, 'proj-a/universal/sessions/ops/monthly.json'), '{}', 'utf-8');

    const res = await api('/ops/jobs/weekly/rename', { method: 'POST', body: JSON.stringify({ id: 'monthly' }) });
    expect(res.status).toBe(409);
    expect((await res.json()).conflicts.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(userDir, '.ant/agents/ops/jobs/weekly'))).toBe(true);
    expect(fs.existsSync(path.join(userDir, 'proj-a/universal/sessions/ops/weekly.json'))).toBe(true);
  });

  it('an id taken by a sibling job → 409; unknown job → 404; readonly scope → 403', async () => {
    await api('/ops/jobs', { method: 'POST', body: JSON.stringify({ id: 'monthly', name: 'Monthly' }) });
    expect(
      (await api('/ops/jobs/weekly/rename', { method: 'POST', body: JSON.stringify({ id: 'monthly' }) })).status,
    ).toBe(409);
    expect(
      (await api('/ops/jobs/ghost/rename', { method: 'POST', body: JSON.stringify({ id: 'x' }) })).status,
    ).toBe(404);
    expect(
      (await api('/assistant/jobs/chat/rename', { method: 'POST', body: JSON.stringify({ id: 'x' }) })).status,
    ).toBe(403);
  });

  it('invalid target id → 400; same id → no-op 200', async () => {
    expect(
      (await api('/ops/jobs/weekly/rename', { method: 'POST', body: JSON.stringify({ id: 'Bad_Id' }) })).status,
    ).toBe(400);
    const same = await api('/ops/jobs/weekly/rename', { method: 'POST', body: JSON.stringify({ id: 'weekly' }) });
    expect(same.status).toBe(200);
    expect((await same.json()).movedProjects).toEqual([]);
  });
});

describe('definition file endpoints', () => {
  beforeEach(async () => {
    await createAgent();
  });

  it('GET files returns the tree; GET file returns content; readonly agents are viewable', async () => {
    const tree = await (await api('/ops/files')).json();
    const names = tree.tree.map((n: any) => n.name);
    expect(names).toContain('agent.yaml');
    expect(names).not.toContain('intents.yaml');

    const file = await (await api('/ops/file?path=agent.yaml')).json();
    expect(file.content).toContain('id: ops');

    const builtinTree = await api('/assistant/files');
    expect(builtinTree.status).toBe(200);
    expect((await builtinTree.json()).readonly).toBe(true);
  });

  it.each([
    ['YAML syntax error → 400, NOT written', 'agent.yaml', 'id: [unclosed', 400],
    ['agent.yaml id ≠ dir name → 400, NOT written', 'agent.yaml', 'id: not-ops\nname: x\n', 400],
    ['whitelist violation → 400', 'random/deep/file.md', 'x', 400],
    ['traversal → whitelist 400', '../escape.md', 'x', 400],
  ] as const)('PUT gate: %s', async (_label, relPath, content, expectedStatus) => {
    const before = fs.readFileSync(path.join(userDir, '.ant/agents/ops/agent.yaml'), 'utf-8');
    const res = await api('/ops/file', { method: 'PUT', body: JSON.stringify({ path: relPath, content }) });
    expect(res.status).toBe(expectedStatus);
    expect(fs.readFileSync(path.join(userDir, '.ant/agents/ops/agent.yaml'), 'utf-8')).toBe(before);
  });

  it.each([
    ['agent.yaml with tools', 'agent.yaml', 'id: ops\nname: x\ntools:\n  builtin: [read_file]\n', /moved to job level/],
    ['agent.yaml with description', 'agent.yaml', 'id: ops\nname: x\ndescription: legacy\n', /"description" was removed/],
    ['agent.yaml with workspace', 'agent.yaml', 'id: ops\nname: x\nworkspace: none\n', /"workspace" was removed/],
    ['job.yaml with outputs', 'jobs/weekly/job.yaml', 'id: weekly\nname: W\noutputs: { mode: free }\n', /"outputs" was removed/],
    ['job.yaml with plan', 'jobs/weekly/job.yaml', "id: weekly\nname: W\nplan: suggested\n", /"plan" was removed/],
  ] as const)('PUT legacy key: %s → 400 with migration message', async (_label, relPath, content, pattern) => {
    await api('/ops/jobs', { method: 'POST', body: JSON.stringify({ id: 'weekly', name: 'W' }) });
    const res = await api('/ops/file', { method: 'PUT', body: JSON.stringify({ path: relPath, content }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(pattern);
  });

  it.each([
    // on-demand/ docs (agent + job level, .md/.json, any depth) are writable;
    // other extensions stay outside the whitelist.
    ['agent on-demand md', 'on-demand/erp/notes.md', 'x', 200],
    ['agent on-demand json (vendor swagger verbatim)', 'on-demand/erp/openapi.json', '{"openapi":"3.0"}', 200],
    ['on-demand txt → 400', 'on-demand/erp/notes.txt', 'x', 400],
  ] as const)('PUT on-demand path: %s → %s', async (_label, relPath, content, expectedStatus) => {
    const res = await api('/ops/file', { method: 'PUT', body: JSON.stringify({ path: relPath, content }) });
    expect(res.status).toBe(expectedStatus);
  });

  // One message for a missing `path` and a missing `content` made a dropped
  // `path` read as a size problem; the caller "fixed" it by splitting the file
  // across two PUTs, which replaced instead of appending. Each field names
  // itself, and the response reports what the write replaced.
  it.each([
    ['path missing', { content: '# doc' }, /^path is required/],
    ['content missing', { path: 'on-demand/notes.md' }, /^content is required/],
    ['content not a string', { path: 'on-demand/notes.md', content: 42 }, /^content must be a string \(got: number\)/],
    ['content is an array', { path: 'on-demand/notes.md', content: ['a'] }, /^content must be a string \(got: array\)/],
  ] as const)('PUT missing field: %s → 400 naming that field', async (_label, body, pattern) => {
    const res = await api('/ops/file', { method: 'PUT', body: JSON.stringify(body) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(pattern);
  });

  it('PUT reports the bytes it replaced — a shrinking rewrite is visible, not refused', async () => {
    const put = (c: string) => api('/ops/file', { method: 'PUT', body: JSON.stringify({ path: 'on-demand/doc.md', content: c }) });

    const created = await put('#'.repeat(100));
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({ replacedBytes: 0, newBytes: 100 });

    // The overwrite that looked like an append: allowed, but observable.
    const overwritten = await put('tail');
    expect(overwritten.status).toBe(200);
    expect(await overwritten.json()).toMatchObject({ replacedBytes: 100, newBytes: 4 });
    expect(fs.readFileSync(path.join(userDir, '.ant/agents/ops/on-demand/doc.md'), 'utf-8')).toBe('tail');
  });

  it('PUT job-level on-demand doc lands under the job dir', async () => {
    await api('/ops/jobs', { method: 'POST', body: JSON.stringify({ id: 'weekly', name: 'W' }) });
    const res = await api('/ops/file', {
      method: 'PUT',
      body: JSON.stringify({ path: 'jobs/weekly/on-demand/fields.md', content: '# fields' }),
    });
    expect(res.status).toBe(200);
    expect(fs.readFileSync(path.join(userDir, '.ant/agents/ops/jobs/weekly/on-demand/fields.md'), 'utf-8')).toBe('# fields');
  });

  it.each([
    ['agent.yaml apis missing baseUrl', 'agent.yaml', 'id: ops\nname: x\napis:\n  erp: {}\n', /"baseUrl" is required/],
    ['agent.yaml apis with mcp key', 'agent.yaml', 'id: ops\nname: x\napis:\n  erp:\n    baseUrl: https://x/api\n    url: https://y\n', /belongs to mcp\.servers/],
    ['job.yaml apis bad allow line', 'jobs/weekly/job.yaml', 'id: weekly\nname: W\napis:\n  erp:\n    baseUrl: https://x/api\n    allow: [GET]\n', /allow rule/],
  ] as const)('PUT apis contract: %s → 400', async (_label, relPath, content, pattern) => {
    await api('/ops/jobs', { method: 'POST', body: JSON.stringify({ id: 'weekly', name: 'W' }) });
    const res = await api('/ops/file', { method: 'PUT', body: JSON.stringify({ path: relPath, content }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(pattern);
  });

  it.each([
    ['agent-level intents.yaml', 'intents.yaml', /intents are job-only/],
    ['job-level single-file intents.yaml', 'jobs/weekly/intents.yaml', /was replaced by per-intent directories/],
    ['agent-level injections file', 'injections/style.md', /injections\/ was removed/],
    ['job-level injections file', 'jobs/weekly/injections/style.md', /injections\/ was removed/],
    ['per-intent intent.yaml', 'jobs/weekly/intents/review/intent.yaml', /was replaced by infer\.md/],
    ['agent-level reference doc', 'reference/erp/spec.md', /reference\/ was renamed to on-demand\//],
    ['job-level reference doc', 'jobs/weekly/reference/erp/spec.json', /reference\/ was renamed to on-demand\//],
  ] as const)('PUT legacy path: %s → 400 with move instruction', async (_label, relPath, pattern) => {
    const res = await api('/ops/file', { method: 'PUT', body: JSON.stringify({ path: relPath, content: 'x' }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(pattern);
  });

  it.each([
    // The per-file contract is enforced pre-write.
    ['reserved general dirname', 'jobs/weekly/intents/general/infer.md',
      'nope\n', /implicit fallback/],
    ['empty criterion body', 'jobs/weekly/intents/review/infer.md',
      '   \n', /non-empty body/],
    ['unterminated frontmatter fence', 'jobs/weekly/intents/review/infer.md',
      '---\nclarify: false\nno close\n', /never closes/],
    ['frontmatter default (removed knob)', 'jobs/weekly/intents/review/infer.md',
      '---\ndefault: true\n---\nx\n', /"default" was removed/],
    ['frontmatter hooks (moved to hooks.yaml)', 'jobs/weekly/intents/review/infer.md',
      '---\nhooks: {}\n---\nx\n', /"hooks" moved to/],
    ['oversized criterion body', 'jobs/weekly/intents/review/infer.md',
      'x'.repeat(1001) + '\n', /exceeds 1000/],
    ['hooks.yaml without the wrapper key', 'jobs/weekly/intents/review/hooks.yaml',
      'stop:\n  - artifact: r.md\n', /exactly one top-level "hooks" key/],
    ['hooks.yaml with an invalid action', 'jobs/weekly/intents/review/hooks.yaml',
      'hooks:\n  stop:\n    - action: frobnicate\n', /neither a universal builtin/],
  ] as const)('PUT intent contract violation (%s) → 400 pre-write gate, NOT written', async (_label, relPath, content, pattern) => {
    await api('/ops/jobs', { method: 'POST', body: JSON.stringify({ id: 'weekly', name: 'W' }) });
    const res = await api('/ops/file', { method: 'PUT', body: JSON.stringify({ path: relPath, content }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(pattern);
    expect(fs.existsSync(path.join(userDir, '.ant/agents/ops', relPath))).toBe(false);
  });

  it('PUT the 33rd intent infer.md → 400 pre-write catalog cap; editing an existing one stays legal', async () => {
    await api('/ops/jobs', { method: 'POST', body: JSON.stringify({ id: 'weekly', name: 'W' }) });
    const intentsDir = path.join(userDir, '.ant/agents/ops/jobs/weekly/intents');
    for (let i = 0; i < 32; i++) {
      const dir = path.join(intentsDir, `intent-${String(i).padStart(2, '0')}`);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'infer.md'), 'x\n');
    }
    const put = (p: string, c: string) => api('/ops/file', { method: 'PUT', body: JSON.stringify({ path: p, content: c }) });
    const overflow = await put('jobs/weekly/intents/one-more/infer.md', 'y\n');
    expect(overflow.status).toBe(400);
    expect((await overflow.json()).error).toMatch(/cap is 32/);
    expect(fs.existsSync(path.join(intentsDir, 'one-more'))).toBe(false);
    // Re-saving an existing intent is an edit, not a birth — stays legal.
    expect((await put('jobs/weekly/intents/intent-00/infer.md', 'updated\n')).status).toBe(200);
  });

  it('PUT semantic error → 200 SAVED with validation.errors warnings', async () => {
    await api('/ops/jobs', { method: 'POST', body: JSON.stringify({ id: 'weekly', name: 'W' }) });
    const put = (p: string, c: string) => api('/ops/file', { method: 'PUT', body: JSON.stringify({ path: p, content: c }) });
    await put('jobs/weekly/intents/review/infer.md', 'review things\n');
    // Hook syntax is valid per-file, but its MCP server is not declared — a
    // cross-file condition (H8) the pre-write gate cannot see; the post-write
    // dry run reports it as a warning while the file stays on disk.
    const res = await put('jobs/weekly/intents/review/hooks.yaml', 'hooks:\n  stop:\n    - action: mcp__ghost__do-thing\n');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.validation.valid).toBe(false);
    expect(body.validation.errors.join('\n')).toMatch(/no MCP server "ghost"/);
    // The file IS on disk (fix continues in the editor).
    expect(fs.readFileSync(path.join(userDir, '.ant/agents/ops/jobs/weekly/intents/review/hooks.yaml'), 'utf-8')).toContain('mcp__ghost__do-thing');
  });

  it('PUT valid infer.md + prompt.md + hooks.yaml → 200, validation.valid true', async () => {
    await api('/ops/jobs', { method: 'POST', body: JSON.stringify({ id: 'weekly', name: 'W' }) });
    const put = (p: string, c: string) => api('/ops/file', { method: 'PUT', body: JSON.stringify({ path: p, content: c }) });
    const res = await put('jobs/weekly/intents/research/infer.md', '---\nclarify: false\n---\nresearch things\n');
    expect(res.status).toBe(200);
    expect((await res.json()).validation).toEqual({ valid: true, errors: [] });
    const prompt = await put('jobs/weekly/intents/research/prompt.md', 'Research, then write the findings to `reports/{week}-weekly.md`.\n');
    expect(prompt.status).toBe(200);
    expect((await prompt.json()).validation).toEqual({ valid: true, errors: [] });
    const hooks = await put('jobs/weekly/intents/research/hooks.yaml', 'hooks:\n  stop:\n    - artifact: reports/*-weekly.md\n');
    expect(hooks.status).toBe(200);
    expect((await hooks.json()).validation).toEqual({ valid: true, errors: [] });
    // H9: strip the output step from the prompt and the same definition still
    // SAVES (200) but fails validation — an artifact hook whose glob no
    // prompt step names is an authoring defect, surfaced where the author
    // self-corrects, never a load failure.
    const unpaired = await put('jobs/weekly/intents/research/prompt.md', 'Research procedure prose, reply in chat.\n');
    expect(unpaired.status).toBe(200);
    const validation = (await unpaired.json()).validation;
    expect(validation.valid).toBe(false);
    expect(validation.errors.join('\n')).toContain('never names a path under "reports/"');
  });

  it('structural files cannot be deleted or renamed (delete the agent/job/intent directory instead)', async () => {
    expect((await api('/ops/file?path=agent.yaml', { method: 'DELETE' })).status).toBe(400);
    const rename = await api('/ops/files/rename', {
      method: 'POST',
      body: JSON.stringify({ path: 'agent.yaml', newName: 'other.yaml' }),
    });
    expect(rename.status).toBe(400);
  });

  it('infer.md alone is structural; the intent DIRECTORY deletes and renames as the unit', async () => {
    await api('/ops/jobs', { method: 'POST', body: JSON.stringify({ id: 'weekly', name: 'W' }) });
    const put = (p: string, c: string) => api('/ops/file', { method: 'PUT', body: JSON.stringify({ path: p, content: c }) });
    const INFER = '---\nclarify: false\n---\nreport work\n';
    await put('jobs/weekly/intents/report/infer.md', INFER);
    await put('jobs/weekly/intents/report/prompt.md', 'Report prose.\n');
    await put('jobs/weekly/intents/report/hooks.yaml', 'hooks:\n  stop:\n    - artifact: reports/*.md\n');

    // infer.md alone: neither deletable nor renamable.
    expect((await api('/ops/file?path=jobs/weekly/intents/report/infer.md', { method: 'DELETE' })).status).toBe(400);
    expect((await api('/ops/files/rename', {
      method: 'POST',
      body: JSON.stringify({ path: 'jobs/weekly/intents/report/infer.md', newName: 'other.md' }),
    })).status).toBe(400);
    // The optional prompt.md and hooks.yaml stay freely deletable.
    expect((await api('/ops/file?path=jobs/weekly/intents/report/hooks.yaml', { method: 'DELETE' })).status).toBe(200);

    // Directory rename is a PURE fs move — no file declares the id, so every
    // file's bytes survive verbatim.
    const rename = await api('/ops/files/rename', {
      method: 'POST',
      body: JSON.stringify({ path: 'jobs/weekly/intents/report', newName: 'digest' }),
    });
    expect(rename.status).toBe(200);
    expect(fs.existsSync(path.join(userDir, '.ant/agents/ops/jobs/weekly/intents/report'))).toBe(false);
    expect(fs.readFileSync(path.join(userDir, '.ant/agents/ops/jobs/weekly/intents/digest/infer.md'), 'utf-8')).toBe(INFER);
    // Renaming to the reserved id is refused.
    expect((await api('/ops/files/rename', {
      method: 'POST',
      body: JSON.stringify({ path: 'jobs/weekly/intents/digest', newName: 'general' }),
    })).status).toBe(400);

    // Directory delete removes the whole intent.
    const del = await api('/ops/file?path=jobs/weekly/intents/digest', { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(fs.existsSync(path.join(userDir, '.ant/agents/ops/jobs/weekly/intents/digest'))).toBe(false);
  });

  it('create + delete a whitelisted file round-trips', async () => {
    await api('/ops/jobs', { method: 'POST', body: JSON.stringify({ id: 'weekly', name: 'W' }) });
    const rel = 'jobs/weekly/base/extra.md';
    const create = await api('/ops/files/create', { method: 'POST', body: JSON.stringify({ path: rel }) });
    expect(create.status).toBe(200);
    expect(fs.existsSync(path.join(userDir, '.ant/agents/ops', rel))).toBe(true);
    const del = await api(`/ops/file?path=${encodeURIComponent(rel)}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(fs.existsSync(path.join(userDir, '.ant/agents/ops', rel))).toBe(false);
  });

  it('legacy agent-level file remains deletable (the migration escape hatch)', async () => {
    // A pre-migration dir may still hold intents.yaml at the agent root; the
    // DELETE route only blocks structural files, so cleanup stays possible.
    fs.writeFileSync(path.join(userDir, '.ant/agents/ops/intents.yaml'), 'version: 1\nintents: []\n');
    const del = await api('/ops/file?path=intents.yaml', { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(fs.existsSync(path.join(userDir, '.ant/agents/ops/intents.yaml'))).toBe(false);
  });
});

describe('definition dir policy (create/upload vocabulary)', () => {
  it.each([
    ['', ['agent.yaml'], undefined, ['base', 'jobs', 'on-demand'], undefined],
    ['base', [], ['.md'], [], undefined],
    ['jobs', [], undefined, [], 'job'],
    ['jobs/weekly', ['job.yaml'], undefined, ['base', 'intents', 'on-demand'], undefined],
    ['jobs/weekly/base', [], ['.md'], [], undefined],
    ['jobs/weekly/intents', [], undefined, [], 'intent'],
    ['jobs/weekly/intents/research', ['infer.md', 'prompt.md', 'hooks.yaml'], undefined, [], undefined],
    // on-demand/ admits .md + .json docs at any depth (agent- and job-level).
    ['on-demand', [], ['.md', '.json'], [], undefined],
    ['on-demand/douzone', [], ['.md', '.json'], [], undefined],
    ['jobs/weekly/on-demand', [], ['.md', '.json'], [], undefined],
    ['jobs/weekly/on-demand/vendor/v2', [], ['.md', '.json'], [], undefined],
  ])('%s', (dir, fixedFiles, acceptedExtensions, fixedDirs, customIdChild) => {
    const policy = getDefinitionDirPolicy(dir as string);
    expect(policy.fixedFiles).toEqual(fixedFiles);
    expect(policy.acceptedExtensions).toEqual(acceptedExtensions);
    expect(policy.fixedDirs).toEqual(fixedDirs);
    expect(policy.customIdChild).toEqual(customIdChild);
  });

  it.each(['foo', 'base/nested', 'jobs/weekly/intents/research/deeper', '../escape'])(
    'off-whitelist dir → unknown (%s)',
    (dir) => {
      expect(getDefinitionDirPolicy(dir).kind).toBe('unknown');
    },
  );
});

describe('mkdir', () => {
  beforeEach(async () => {
    await createAgent();
  });

  it('a missing container is created; an existing one 409s; off-whitelist 400', async () => {
    // The agent scaffold already ships base/ and jobs/ — a job's base/ is the
    // container that can still be absent.
    await api('/ops/jobs', { method: 'POST', body: JSON.stringify({ id: 'weekly', name: 'W' }) });
    fs.rmSync(path.join(userDir, '.ant/agents/ops/jobs/weekly/base'), { recursive: true, force: true });

    const ok = await api('/ops/files/mkdir', {
      method: 'POST',
      body: JSON.stringify({ path: 'jobs/weekly/base' }),
    });
    expect(ok.status).toBe(200);
    expect(fs.existsSync(path.join(userDir, '.ant/agents/ops/jobs/weekly/base'))).toBe(true);

    const dup = await api('/ops/files/mkdir', { method: 'POST', body: JSON.stringify({ path: 'base' }) });
    expect(dup.status).toBe(409);

    const bad = await api('/ops/files/mkdir', { method: 'POST', body: JSON.stringify({ path: 'foo' }) });
    expect(bad.status).toBe(400);
    expect(fs.existsSync(path.join(userDir, '.ant/agents/ops/foo'))).toBe(false);
  });

  it('intents container under an existing job is allowed', async () => {
    await api('/ops/jobs', { method: 'POST', body: JSON.stringify({ id: 'weekly', name: 'W' }) });
    const res = await api('/ops/files/mkdir', {
      method: 'POST',
      body: JSON.stringify({ path: 'jobs/weekly/intents' }),
    });
    expect(res.status).toBe(200);
    expect(fs.existsSync(path.join(userDir, '.ant/agents/ops/jobs/weekly/intents'))).toBe(true);
  });

  it('job / intent dirs are refused with a pointer — creation has one owner each', async () => {
    const job = await api('/ops/files/mkdir', { method: 'POST', body: JSON.stringify({ path: 'jobs/weekly' }) });
    expect(job.status).toBe(400);
    expect((await job.json()).error).toMatch(/POST \/:agentId\/jobs/);

    const intent = await api('/ops/files/mkdir', {
      method: 'POST',
      body: JSON.stringify({ path: 'jobs/weekly/intents/research' }),
    });
    expect(intent.status).toBe(400);
    expect((await intent.json()).error).toMatch(/infer\.md/);
  });
});

describe('directory-unit upload (replaceDir)', () => {
  beforeEach(async () => {
    await createAgent();
    await api('/ops/jobs', { method: 'POST', body: JSON.stringify({ id: 'weekly', name: 'W' }) });
    fs.writeFileSync(path.join(userDir, '.ant/agents/ops/jobs/weekly/base/stale.md'), 'stale\n');
  });

  function jobUpload(fields: Record<string, string> = {}): FormData {
    const form = new FormData();
    form.append('files', new Blob(['id: weekly\nname: Fresh\n']), 'job.yaml');
    form.append('relativePaths', 'jobs/weekly/job.yaml');
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    return form;
  }

  it('replaces the target directory — files absent from the upload are gone', async () => {
    const res = await fetch(`${baseUrl}/api/definitions/agents/ops/files/upload`, {
      method: 'POST',
      body: jobUpload({ replaceDir: 'jobs/weekly' }),
    });
    expect(res.status).toBe(200);
    expect(fs.existsSync(path.join(userDir, '.ant/agents/ops/jobs/weekly/base/stale.md'))).toBe(false);
    expect(
      fs.readFileSync(path.join(userDir, '.ant/agents/ops/jobs/weekly/job.yaml'), 'utf-8'),
    ).toContain('Fresh');
  });

  it('without replaceDir it merges — siblings survive', async () => {
    const res = await fetch(`${baseUrl}/api/definitions/agents/ops/files/upload`, {
      method: 'POST',
      body: jobUpload(),
    });
    expect(res.status).toBe(200);
    expect(fs.existsSync(path.join(userDir, '.ant/agents/ops/jobs/weekly/base/stale.md'))).toBe(true);
  });

  it.each([
    ['foo', 'off-whitelist'],
    ['', 'agent root'],
    ['jobs/other', 'paths outside it'],
  ])('rejects replaceDir=%s and writes nothing', async (replaceDir) => {
    const body = replaceDir === '' ? jobUpload({ replaceDir: '.' }) : jobUpload({ replaceDir });
    const res = await fetch(`${baseUrl}/api/definitions/agents/ops/files/upload`, { method: 'POST', body });
    expect(res.status).toBe(400);
    // The pre-existing directory is untouched — validation precedes the rm.
    expect(fs.existsSync(path.join(userDir, '.ant/agents/ops/jobs/weekly/base/stale.md'))).toBe(true);
  });
});

describe('folder import', () => {
  it('missing agent.yaml → 400; valid folder → 201 with skip-with-reason for off-whitelist files', async () => {
    const form = new FormData();
    form.append('files', new Blob(['# base']), 'system.md');
    form.append('relativePaths', 'imported/base/system.md');
    const missing = await fetch(`${baseUrl}/api/definitions/agents/import`, { method: 'POST', body: form });
    expect(missing.status).toBe(400);

    const full = new FormData();
    full.append('files', new Blob(['id: imported\nname: Imported\n']), 'agent.yaml');
    full.append('relativePaths', 'imported/agent.yaml');
    full.append('files', new Blob(['# base']), 'system.md');
    full.append('relativePaths', 'imported/base/system.md');
    full.append('files', new Blob(['skip me']), 'notes.txt');
    full.append('relativePaths', 'imported/random/notes.txt');
    // Legacy agent-level intents.yaml is off-whitelist now — must be skipped.
    full.append('files', new Blob(['version: 1\nintents: []\n']), 'intents.yaml');
    full.append('relativePaths', 'imported/intents.yaml');
    const ok = await fetch(`${baseUrl}/api/definitions/agents/import`, { method: 'POST', body: full });
    expect(ok.status).toBe(201);
    const body = await ok.json();
    expect(body.agentId).toBe('imported');
    expect(body.uploaded).toContain('agent.yaml');
    expect(body.skipped).toEqual([
      { path: 'imported/random/notes.txt', reason: 'outside the definition whitelist' },
      { path: 'imported/intents.yaml', reason: 'outside the definition whitelist' },
    ]);
    expect(fs.existsSync(path.join(userDir, '.ant/agents/imported/base/system.md'))).toBe(true);
    expect(fs.existsSync(path.join(userDir, '.ant/agents/imported/intents.yaml'))).toBe(false);
  });

  it('same-id import → 409; with overwrite → REPLACE (stale definition files gone)', async () => {
    await createAgent('imported');
    fs.writeFileSync(path.join(userDir, '.ant/agents/imported/base/stale.md'), 'stale\n');

    const build = (fields: Record<string, string> = {}) => {
      const form = new FormData();
      form.append('files', new Blob(['id: imported\nname: Fresh\n']), 'agent.yaml');
      form.append('relativePaths', 'imported/agent.yaml');
      for (const [k, v] of Object.entries(fields)) form.append(k, v);
      return form;
    };

    const blocked = await fetch(`${baseUrl}/api/definitions/agents/import`, { method: 'POST', body: build() });
    expect(blocked.status).toBe(409);
    expect(fs.existsSync(path.join(userDir, '.ant/agents/imported/base/stale.md'))).toBe(true);

    const ok = await fetch(`${baseUrl}/api/definitions/agents/import`, {
      method: 'POST',
      body: build({ overwrite: 'true' }),
    });
    expect(ok.status).toBe(201);
    expect(fs.existsSync(path.join(userDir, '.ant/agents/imported/base/stale.md'))).toBe(false);
    expect(fs.readFileSync(path.join(userDir, '.ant/agents/imported/agent.yaml'), 'utf-8')).toContain('Fresh');
  });

  it('overwrite does NOT apply to a readonly (builtin) id — still 409', async () => {
    const form = new FormData();
    form.append('files', new Blob(['id: assistant\nname: Mine\n']), 'agent.yaml');
    form.append('relativePaths', 'assistant/agent.yaml');
    form.append('overwrite', 'true');
    const res = await fetch(`${baseUrl}/api/definitions/agents/import`, { method: 'POST', body: form });
    expect(res.status).toBe(409);
    expect(fs.existsSync(path.join(userDir, '.ant/agents/assistant'))).toBe(false);
  });

  it('importing a folder named after a builtin agent → 409 (no silent shadowing)', async () => {
    const form = new FormData();
    form.append('files', new Blob(['id: assistant\nname: Mine\n']), 'agent.yaml');
    form.append('relativePaths', 'assistant/agent.yaml');
    const res = await fetch(`${baseUrl}/api/definitions/agents/import`, { method: 'POST', body: form });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/built-in/);
    expect(fs.existsSync(path.join(userDir, '.ant/agents/assistant'))).toBe(false);
  });
});

describe('folder download (export)', () => {
  it('ZIP carries the whitelisted definition under a single {agentId}/ root, and nothing else', async () => {
    await createAgent('exported');
    const agentDir = path.join(userDir, '.ant/agents/exported');
    fs.writeFileSync(path.join(agentDir, 'base/system.md'), '# system\n');
    fs.mkdirSync(path.join(agentDir, 'on-demand'), { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'on-demand/api.md'), '# api\n');
    // Three shapes that must NOT ride out with the export: an off-whitelist
    // file, a dotfile the settings tree never shows, and a legacy catalog.
    fs.mkdirSync(path.join(agentDir, 'random'), { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'random/notes.txt'), 'private\n');
    fs.writeFileSync(path.join(agentDir, '.env'), 'TOKEN=live\n');
    fs.writeFileSync(path.join(agentDir, 'intents.yaml'), 'version: 1\n');

    const res = await api('/exported/download');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toContain('attachment; filename="exported.zip"');

    const names = zipEntryNames(Buffer.from(await res.arrayBuffer())).sort();
    expect(names).toEqual([
      'exported/agent.yaml',
      'exported/base/role.md',
      'exported/base/system.md',
      'exported/on-demand/api.md',
    ]);
  });

  it('a readonly (builtin) agent is exportable — it is a read of bytes the file endpoints already serve', async () => {
    const res = await api('/assistant/download');
    expect(res.status).toBe(200);
    const names = zipEntryNames(Buffer.from(await res.arrayBuffer()));
    expect(names).toContain('assistant/agent.yaml');
    expect(names.every((n) => n.startsWith('assistant/'))).toBe(true);
  });

  it('unknown agent → 404; traversal id → 400', async () => {
    expect((await api('/nope/download')).status).toBe(404);
    expect((await api(`/${encodeURIComponent('../../etc')}/download`)).status).toBe(400);
  });
});

describe('prompt preview', () => {
  beforeEach(async () => {
    await createAgent();
    await api('/ops/jobs', { method: 'POST', body: JSON.stringify({ id: 'weekly', name: 'W' }) });
    fs.mkdirSync(path.join(userDir, '.ant/agents/ops/jobs/weekly/intents/research'), { recursive: true });
    fs.writeFileSync(
      path.join(userDir, '.ant/agents/ops/jobs/weekly/intents/research/infer.md'),
      'research things\n',
    );
    fs.writeFileSync(
      path.join(userDir, '.ant/agents/ops/jobs/weekly/intents/research/prompt.md'),
      'STYLE-BODY sentinel.\n',
    );
  });

  it('returns the composed block; active intents flip a prompt between pointer and inlined', async () => {
    const tocOnly = await (await api('/ops/jobs/weekly/prompt-preview')).json();
    expect(tocOnly.system).toContain('<custom_job_instructions id="ops/weekly"');
    expect(tocOnly.inlined).toEqual([]);
    expect(tocOnly.toc).toEqual(['research']);
    expect(tocOnly.harnessTemplates.length).toBe(3);

    const active = await (await api('/ops/jobs/weekly/prompt-preview?intents=research')).json();
    expect(active.activeIntents).toEqual(['research']);
    expect(active.inlined).toEqual(['research']);
    expect(active.system).toContain('STYLE-BODY sentinel.');
  });

  it('unknown intent → 400 unknown-intent', async () => {
    const res = await api('/ops/jobs/weekly/prompt-preview?intents=ghost');
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('unknown-intent');
  });

  it('builtin (readonly) jobs are previewable', async () => {
    const res = await api('/assistant/jobs/chat/prompt-preview');
    expect(res.status).toBe(200);
    expect((await res.json()).system).toContain('<custom_job_instructions id="assistant/chat"');
  });
});

// ── org-owned agents (team org) ──────────────────────────────────────────────
//
// A second app instance with a JWT-shaped identity middleware (req.user /
// req.organization) and a fake org repo — extractUserContext takes priority 1,
// so these rows exercise the team-kind derivation + org ACL gates end-to-end.

describe('org-owned agents (team org)', () => {
  const ORG = 'acme';
  const OWNER = 'owner@acme.io';
  const EDITOR = 'editor@acme.io';
  const ADMIN = 'admin@acme.io';
  const MEMBER = 'member@acme.io';
  const GHOST = 'removed@acme.io'; // stale JWT: org claim without a membership row

  let teamServer: http.Server;
  let teamBaseUrl: string;
  let currentUser = OWNER;
  const memberships = new Map<string, OrgMembershipRole>();

  function teamApi(pathname: string, init?: RequestInit): Promise<Response> {
    return fetch(`${teamBaseUrl}/api/definitions/agents${pathname}`, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
  }

  const personalAgents = () => path.join(wsRoot, 'individual', currentUser, '.ant/agents');
  const legacyAgents = (user: string) => path.join(wsRoot, ORG, user, '.ant/agents');
  const orgAgents = () => path.join(wsRoot, ORG, '.ant/agents');
  const aclPath = () => path.join(wsRoot, ORG, '.ant', 'agent-acl.json');

  function seedAgentDir(container: string, agentId: string): void {
    const dir = path.join(container, agentId);
    fs.mkdirSync(path.join(dir, 'base'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'agent.yaml'), yaml.dump({ id: agentId, name: agentId, version: 1 }));
    fs.writeFileSync(path.join(dir, 'base', 'role.md'), 'Persona.');
  }

  function seedAcl(agents: Record<string, { owner: string; editors: string[] }>): void {
    fs.mkdirSync(path.dirname(aclPath()), { recursive: true });
    fs.writeFileSync(aclPath(), JSON.stringify({ version: 1, agents }, null, 2));
  }

  function readAcl(): { version: 1; agents: Record<string, { owner: string; editors: string[] }> } {
    return JSON.parse(fs.readFileSync(aclPath(), 'utf-8'));
  }

  beforeAll(async () => {
    const resolver = {
      getWorkspacePath: () => path.join(wsRoot, ORG, currentUser),
      getPhysicalWorkspacesPath: () => wsRoot,
    } as unknown as WorkspaceResolver;

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).user = { id: currentUser, email: currentUser };
      (req as any).organization = { id: ORG, kind: 'team' };
      next();
    });
    app.use(
      '/api/definitions/agents',
      createAccountAgentRoutes({ workspaceResolver: resolver, organizationRepository: fakeOrgRepo(memberships, ORG) }),
    );
    teamServer = http.createServer(app);
    await new Promise<void>((resolve) => teamServer.listen(0, resolve));
    const address = teamServer.address() as { port: number };
    teamBaseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => teamServer.close((e) => (e ? reject(e) : resolve())));
  });

  beforeEach(() => {
    currentUser = OWNER;
    memberships.clear();
    memberships.set(OWNER, 'member'); // agent owner ≠ org role — plain member by default
    memberships.set(EDITOR, 'member');
    memberships.set(ADMIN, 'admin');
    memberships.set(MEMBER, 'member');
    fs.rmSync(path.join(wsRoot, 'individual'), { recursive: true, force: true });
    fs.rmSync(path.join(wsRoot, ORG), { recursive: true, force: true });
  });

  describe('promotion', () => {
    it('moves a personal agent into the org root, records the caller as owner → 201', async () => {
      seedAgentDir(personalAgents(), 'ops');
      const res = await teamApi('/ops/promote', { method: 'POST', body: '{}' });
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ id: 'ops', scope: 'org', owner: OWNER });
      expect(fs.existsSync(path.join(personalAgents(), 'ops'))).toBe(false);
      expect(fs.existsSync(path.join(orgAgents(), 'ops', 'agent.yaml'))).toBe(true);
      expect(readAcl().agents.ops).toEqual({ owner: OWNER, editors: [] });
    });

    it('org id already occupied → 409 and nothing moves', async () => {
      seedAgentDir(personalAgents(), 'ops');
      seedAgentDir(orgAgents(), 'ops');
      const res = await teamApi('/ops/promote', { method: 'POST', body: '{}' });
      expect(res.status).toBe(409);
      expect(fs.existsSync(path.join(personalAgents(), 'ops'))).toBe(true);
    });

    it('non-member caller (stale JWT) → 403 MEMBERSHIP_REQUIRED', async () => {
      currentUser = GHOST;
      seedAgentDir(personalAgents(), 'ops');
      const res = await teamApi('/ops/promote', { method: 'POST', body: '{}' });
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe('MEMBERSHIP_REQUIRED');
    });

    it('org/builtin source → 400 not-user-scope; unknown agent → 404', async () => {
      seedAgentDir(orgAgents(), 'shared');
      seedAcl({ shared: { owner: OWNER, editors: [] } });
      expect((await teamApi('/shared/promote', { method: 'POST', body: '{}' })).status).toBe(400);
      expect((await teamApi('/ghost/promote', { method: 'POST', body: '{}' })).status).toBe(404);
    });

    it('non-team active org → 400 not-team-active (local-tenant mount)', async () => {
      const res = await api('/whatever/promote', { method: 'POST', body: '{}' });
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('not-team-active');
    });

    it('pre-org-agents team-path definitions are retired: not listed, not promotable', async () => {
      seedAgentDir(legacyAgents(OWNER), 'old-agent');

      const list = await (await teamApi('')).json();
      expect(list.agents.some((a: any) => a.id === 'old-agent')).toBe(false);

      const res = await teamApi('/old-agent/promote', { method: 'POST', body: '{}' });
      expect(res.status).toBe(404);
    });
  });

  describe('org agent edit matrix (owner ∨ editors ∨ live admin role)', () => {
    beforeEach(() => {
      seedAgentDir(orgAgents(), 'shared');
      seedAcl({ shared: { owner: OWNER, editors: [EDITOR] } });
    });

    it.each([
      ['owner', OWNER, 200],
      ['delegated editor', EDITOR, 200],
      ['org admin (not owner/editor)', ADMIN, 200],
      ['plain member', MEMBER, 403],
      ['removed member (stale JWT)', GHOST, 403],
    ] as const)('%s → PATCH %i', async (_label, user, expected) => {
      currentUser = user;
      const res = await teamApi('/shared', { method: 'PATCH', body: JSON.stringify({ name: 'renamed' }) });
      expect(res.status).toBe(expected);
      if (expected === 403) expect((await res.json()).code).toBe('org-agent-forbidden');
    });

    it('file PUT and DELETE follow the same gate (member 403, owner 200)', async () => {
      currentUser = MEMBER;
      const putDenied = await teamApi('/shared/file', {
        method: 'PUT',
        body: JSON.stringify({ path: 'base/role.md', content: 'sabotage' }),
      });
      expect(putDenied.status).toBe(403);
      expect((await teamApi('/shared', { method: 'DELETE' })).status).toBe(403);

      currentUser = OWNER;
      const putOk = await teamApi('/shared/file', {
        method: 'PUT',
        body: JSON.stringify({ path: 'base/role.md', content: 'Updated persona.' }),
      });
      expect(putOk.status).toBe(200);
    });

    it('every member can VIEW an org agent (list + files) regardless of edit rights', async () => {
      currentUser = MEMBER;
      const list = await (await teamApi('')).json();
      expect(list.agents.some((a: any) => a.id === 'shared')).toBe(true);
      expect((await teamApi('/shared/files')).status).toBe(200);
    });

    it.each([
      ['owner', OWNER, false],
      ['delegated editor', EDITOR, false],
      ['org admin', ADMIN, false],
      ['plain member', MEMBER, true],
      ['removed member (stale JWT)', GHOST, true],
    ] as const)('GET /files readonly is caller-effective: %s → %s', async (_label, user, readonly) => {
      currentUser = user;
      const body = await (await teamApi('/shared/files')).json();
      expect(body).toMatchObject({ scope: 'org', readonly });
    });

    it('GET /files on a personal agent stays structural (readonly:false)', async () => {
      seedAgentDir(personalAgents(), 'mine');
      const body = await (await teamApi('/mine/files')).json();
      expect(body).toMatchObject({ scope: 'user', readonly: false });
    });

    it('DELETE removes the ACL entry with the definition dir', async () => {
      currentUser = OWNER;
      expect((await teamApi('/shared', { method: 'DELETE' })).status).toBe(200);
      expect(fs.existsSync(path.join(orgAgents(), 'shared'))).toBe(false);
      expect(readAcl().agents.shared).toBeUndefined();
    });
  });

  describe('editors management', () => {
    beforeEach(() => {
      seedAgentDir(orgAgents(), 'shared');
      seedAcl({ shared: { owner: OWNER, editors: [] } });
    });

    it('owner sets editors → 200; membership is validated (non-member → 400)', async () => {
      const bad = await teamApi('/shared/editors', {
        method: 'PUT',
        body: JSON.stringify({ editors: ['stranger@other.io'] }),
      });
      expect(bad.status).toBe(400);
      expect((await bad.json()).code).toBe('editor-not-member');

      const ok = await teamApi('/shared/editors', { method: 'PUT', body: JSON.stringify({ editors: [EDITOR] }) });
      expect(ok.status).toBe(200);
      expect((await ok.json()).editors).toEqual([EDITOR]);
      expect(readAcl().agents.shared.editors).toEqual([EDITOR]);
    });

    it('the owner is implicit — sending it in the list does not persist it', async () => {
      const res = await teamApi('/shared/editors', {
        method: 'PUT',
        body: JSON.stringify({ editors: [OWNER, EDITOR] }),
      });
      expect(res.status).toBe(200);
      expect(readAcl().agents.shared.editors).toEqual([EDITOR]);
    });

    it('non-manager callers → 403 (plain member AND delegated editor)', async () => {
      seedAcl({ shared: { owner: OWNER, editors: [EDITOR] } });
      for (const user of [MEMBER, EDITOR]) {
        currentUser = user;
        const res = await teamApi('/shared/editors', { method: 'PUT', body: JSON.stringify({ editors: [] }) });
        expect(res.status).toBe(403);
      }
    });

    it('org admin manages editors without being owner; permissions endpoint mirrors authority', async () => {
      currentUser = ADMIN;
      const res = await teamApi('/shared/editors', { method: 'PUT', body: JSON.stringify({ editors: [MEMBER] }) });
      expect(res.status).toBe(200);

      const perms = await (await teamApi('/shared/permissions')).json();
      expect(perms).toMatchObject({ owner: OWNER, canEdit: true, canManageEditors: true, editors: [MEMBER] });

      currentUser = MEMBER;
      const memberPerms = await (await teamApi('/shared/permissions')).json();
      expect(memberPerms).toMatchObject({ owner: OWNER, canEdit: true, canManageEditors: false });
      expect(memberPerms.editors).toBeUndefined();
    });

    it('permissions/editors on a personal agent → 404 (aclGoverned org agents only)', async () => {
      seedAgentDir(personalAgents(), 'mine');
      expect((await teamApi('/mine/permissions')).status).toBe(404);
      expect((await teamApi('/mine/editors', { method: 'PUT', body: JSON.stringify({ editors: [] }) })).status).toBe(404);
    });
  });

  describe('list decoration (caller-effective readonly + org projection)', () => {
    beforeEach(() => {
      seedAgentDir(orgAgents(), 'shared');
      seedAcl({ shared: { owner: OWNER, editors: [EDITOR] } });
    });

    it.each([
      // [label, user, readonly, canEdit, canManageEditors, editorsVisible]
      ['owner', OWNER, false, true, true, true],
      ['editor', EDITOR, false, true, false, false],
      ['admin', ADMIN, false, true, true, true],
      ['member', MEMBER, true, false, false, false],
      ['removed (stale JWT)', GHOST, true, false, false, false],
    ] as const)('%s sees the decorated summary', async (_label, user, readonly, canEdit, canManage, editorsVisible) => {
      currentUser = user;
      const list = await (await teamApi('')).json();
      const shared = list.agents.find((a: any) => a.id === 'shared');
      expect(shared.readonly).toBe(readonly);
      expect(shared.org).toMatchObject({ owner: OWNER, canEdit, canManageEditors: canManage });
      if (editorsVisible) expect(shared.org.editors).toEqual([EDITOR]);
      else expect(shared.org.editors).toBeUndefined();
    });

    it('personal agents stay undecorated (no org projection) and anchored to the individual root', async () => {
      seedAgentDir(personalAgents(), 'mine');
      const list = await (await teamApi('')).json();
      const mine = list.agents.find((a: any) => a.id === 'mine');
      expect(mine).toMatchObject({ scope: 'user', readonly: false });
      expect(mine.org).toBeUndefined();
    });

    it('creation targets the individual anchor even while a team org is active (D1 fix)', async () => {
      const res = await teamApi('', { method: 'POST', body: JSON.stringify({ id: 'fresh', name: 'Fresh' }) });
      expect(res.status).toBe(201);
      expect(fs.existsSync(path.join(personalAgents(), 'fresh', 'agent.yaml'))).toBe(true);
      expect(fs.existsSync(path.join(legacyAgents(OWNER), 'fresh'))).toBe(false);
    });
  });

  describe('ACL sidecar is structurally unreachable through the definition-file API', () => {
    beforeEach(() => {
      seedAgentDir(orgAgents(), 'shared');
      seedAcl({ shared: { owner: OWNER, editors: [] } });
    });

    it('GET file with a traversal path → 400; the files tree never lists agent-acl.json', async () => {
      const res = await teamApi('/shared/file?path=' + encodeURIComponent('../../agent-acl.json'));
      expect(res.status).toBe(400);

      const tree = await (await teamApi('/shared/files')).json();
      const flat = JSON.stringify(tree.tree);
      expect(flat).not.toContain('agent-acl.json');
    });

    it('PUT with a traversal path stays refused by the whitelist gate (owner included)', async () => {
      const res = await teamApi('/shared/file', {
        method: 'PUT',
        body: JSON.stringify({ path: '../../agent-acl.json', content: '{"version":1,"agents":{}}' }),
      });
      expect(res.status).toBe(400);
      expect(readAcl().agents.shared).toEqual({ owner: OWNER, editors: [] });
    });
  });
});

/**
 * `self-api` capability pin — a universal job's token reaches the definition
 * surface and nothing else.
 *
 * The definition's own `allow` list cannot be the boundary (it is user-editable
 * and one save away from `* *`), so these assertions run against the guard as
 * it is composed in the server: auth populates `req.user`, the guard runs on
 * the whole `/api` mount, then the routers.
 */
describe('self-api scope pin', () => {
  let pinnedServer: http.Server;
  let pinnedBase: string;
  let scope: 'self-api' | undefined;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    // Stands in for jwtAuth: the claim rides the verified token, never a header
    // the caller controls.
    app.use('/api', (req, _res, next) => {
      req.user = { id: 'localuser', email: 'localuser@localorg', organizationId: 'localorg', ...(scope ? { scope } : {}) };
      next();
    });
    app.use('/api', createSelfApiScopeGuard());
    app.use('/api/projects', (_req, res) => res.status(200).json({ reached: true }));
    app.use('/api/auth/refresh', (_req, res) => res.status(200).json({ reached: true }));
    app.use('/api/definitions/agents', (_req, res) => res.status(200).json({ reached: true }));
    app.use('/api/definitions/pipelines', (_req, res) => res.status(200).json({ reached: true }));
    pinnedServer = http.createServer(app);
    await new Promise<void>((resolve) => pinnedServer.listen(0, resolve));
    pinnedBase = `http://127.0.0.1:${(pinnedServer.address() as { port: number }).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => pinnedServer.close((e) => (e ? reject(e) : resolve())));
  });

  const call = (pathname: string, method = 'GET') =>
    fetch(`${pinnedBase}${pathname}`, { method, headers: { 'Content-Type': 'application/json' } });

  it('reaches the definition surface', async () => {
    scope = 'self-api';
    expect((await call('/api/definitions/agents')).status).toBe(200);
    expect((await call('/api/definitions/agents/ops/file', 'PUT')).status).toBe(200);
  });

  it('refuses every other route, including the one that would mint another token', async () => {
    scope = 'self-api';
    for (const pathname of ['/api/projects', '/api/projects/p/jobs', '/api/auth/refresh']) {
      const res = await call(pathname);
      expect(res.status, pathname).toBe(403);
      expect((await res.json()).code).toBe('self-api-scope');
    }
  });

  it('refuses the routes that spread authority or skip validation', async () => {
    scope = 'self-api';
    for (const pathname of [
      '/api/definitions/agents/ops/promote',
      '/api/definitions/agents/ops/editors',
      '/api/definitions/agents/import',
      '/api/definitions/agents/ops/files/upload',
    ]) {
      const res = await call(pathname, 'POST');
      expect(res.status, pathname).toBe(403);
      expect((await res.json()).code).toBe('self-api-scope');
    }
  });

  /**
   * The pipelines surface is deny-except: only the definition-authoring shapes
   * are admitted, so a route added to `pipelines.routes.ts` later is refused
   * until someone adds it here on purpose.
   */
  it.each([
    ['GET', '/api/definitions/pipelines'],
    ['POST', '/api/definitions/pipelines'],
    ['POST', '/api/definitions/pipelines/preview-fires'],
    ['GET', '/api/definitions/pipelines/activatable-projects'],
    ['GET', '/api/definitions/pipelines/weekly-report'],
    ['PUT', '/api/definitions/pipelines/weekly-report'],
    ['DELETE', '/api/definitions/pipelines/weekly-report'],
    ['GET', '/api/definitions/pipelines/weekly-report/permissions'],
  ])('reaches the pipeline definition surface: %s %s', async (method, pathname) => {
    scope = 'self-api';
    expect((await call(pathname, method)).status).toBe(200);
  });

  it.each([
    // Publish state and project binding are a person's decisions.
    ['POST', '/api/definitions/pipelines/weekly-report/enable'],
    ['POST', '/api/definitions/pipelines/weekly-report/disable'],
    ['POST', '/api/definitions/pipelines/weekly-report/activate'],
    ['POST', '/api/definitions/pipelines/weekly-report/deactivate'],
    ['POST', '/api/definitions/pipelines/weekly-report/run-now'],
    ['POST', '/api/definitions/pipelines/weekly-report/promote'],
    ['PUT', '/api/definitions/pipelines/weekly-report/editors'],
    ['GET', '/api/definitions/pipelines/weekly-report/download'],
    ['GET', '/api/definitions/pipelines/weekly-report/activations'],
    // A job must not resolve its own gate, nor drive run history.
    ['GET', '/api/definitions/pipelines/approvals'],
    ['POST', '/api/definitions/pipelines/approvals/gate-1'],
    ['GET', '/api/definitions/pipelines/runs/run-1'],
    ['POST', '/api/definitions/pipelines/runs/run-1/cancel'],
    ['POST', '/api/definitions/pipelines/runs/run-1/steps/step-1/clarify'],
    ['GET', '/api/definitions/pipelines/weekly-report/runs'],
    // Right shape, wrong method.
    ['POST', '/api/definitions/pipelines/weekly-report'],
    ['PUT', '/api/definitions/pipelines'],
  ])('refuses the operational pipeline surface: %s %s', async (method, pathname) => {
    scope = 'self-api';
    const res = await call(pathname, method);
    expect(res.status, `${method} ${pathname}`).toBe(403);
    expect((await res.json()).code).toBe('self-api-scope');
  });

  it('a reserved literal is never swallowed by the :id rule', async () => {
    scope = 'self-api';
    // `GET /pipelines/:id` is admitted; `GET /pipelines/approvals` must not be.
    expect((await call('/api/definitions/pipelines/weekly-report')).status).toBe(200);
    expect((await call('/api/definitions/pipelines/approvals')).status).toBe(403);
    expect((await call('/api/definitions/pipelines/runs')).status).toBe(403);
    expect((await call('/api/definitions/pipelines/preview-fires')).status).toBe(403); // GET — the route is POST
  });

  it('an ordinary session is untouched — absence of the claim is not a pin', async () => {
    scope = undefined;
    expect((await call('/api/projects')).status).toBe(200);
    expect((await call('/api/definitions/agents/ops/promote', 'POST')).status).toBe(200);
  });
});

/**
 * A shipped definition must not tell the model it may call a route the pin
 * refuses. `allow` is not the boundary, but a builtin that names a refused
 * route sends the agent into a 403 it cannot fix.
 */
describe('builtin definitions stay inside the pin', () => {
  const AGENTS_DIR = path.join(__dirname, '../../src/core/data/agents');

  function selfApiAllowLines(): { agent: string; job: string; line: string }[] {
    const out: { agent: string; job: string; line: string }[] = [];
    for (const agent of fs.readdirSync(AGENTS_DIR)) {
      const jobsDir = path.join(AGENTS_DIR, agent, 'jobs');
      if (!fs.existsSync(jobsDir)) continue;
      for (const job of fs.readdirSync(jobsDir)) {
        const jobYaml = path.join(jobsDir, job, 'job.yaml');
        if (!fs.existsSync(jobYaml)) continue;
        const def = yaml.load(fs.readFileSync(jobYaml, 'utf-8')) as any;
        for (const cfg of Object.values(def?.apis ?? {}) as any[]) {
          if (cfg?.self !== true) continue;
          for (const line of cfg.allow ?? []) out.push({ agent, job, line });
        }
      }
    }
    return out;
  }

  it('every self-api allow line names a route the pin admits', () => {
    const lines = selfApiAllowLines();
    expect(lines.length).toBeGreaterThan(0);
    for (const { agent, job, line } of lines) {
      const [method, pattern] = line.split(/\s+/, 2);
      // Substitute a concrete segment for each wildcard, then ask the guard.
      const concrete = pattern.replace(/\*\*/g, 'x/y').replace(/(?<![a-z])\*(?![a-z*])/g, 'x');
      const res = { statusCode: 0, status(c: number) { this.statusCode = c; return this; }, json() { return this; } };
      let passed = false;
      createSelfApiScopeGuard()(
        { user: { scope: 'self-api' }, path: concrete, method } as any,
        res as any,
        () => { passed = true; },
      );
      expect(passed, `${agent}/${job}: "${line}" resolves to ${method} ${concrete}, which the pin refuses`).toBe(true);
    }
  });
});

/**
 * The same pin on the realtime server. It has no account-agents surface, so
 * every route there is out of scope and the guard refuses the claim wholesale
 * — otherwise a job-minted token opens its owner's SSE stream and `/bridge/*`,
 * well outside the bound the pin declares. Mounting the same guard rather than
 * a bespoke refusal keeps one rule.
 */
describe('self-api scope pin on the realtime surface', () => {
  let rtServer: http.Server;
  let rtBase: string;
  let rtScope: 'self-api' | undefined;

  beforeAll(async () => {
    const app = express();
    app.use((req, _res, next) => {
      req.user = { id: 'localuser', email: 'localuser@localorg', organizationId: 'localorg', ...(rtScope ? { scope: rtScope } : {}) };
      next();
    });
    // Mounted at the root, exactly as RealtimeServer.setupMiddleware does.
    app.use(createSelfApiScopeGuard());
    app.use('/projects', (_req, res) => res.status(200).json({ reached: true }));
    app.use('/bridge', (_req, res) => res.status(200).json({ reached: true }));
    rtServer = http.createServer(app);
    await new Promise<void>((resolve) => rtServer.listen(0, resolve));
    rtBase = `http://127.0.0.1:${(rtServer.address() as { port: number }).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => rtServer.close((e) => (e ? reject(e) : resolve())));
  });

  const rtCall = (pathname: string) => fetch(`${rtBase}${pathname}`);

  it('refuses a job-minted token on the SSE stream and the bridge', async () => {
    rtScope = 'self-api';
    for (const pathname of ['/projects/p/features/f/stream', '/bridge/status']) {
      const res = await rtCall(pathname);
      expect(res.status, pathname).toBe(403);
      expect((await res.json()).code).toBe('self-api-scope');
    }
  });

  it('an ordinary session still reaches them', async () => {
    rtScope = undefined;
    expect((await rtCall('/projects/p/features/f/stream')).status).toBe(200);
    expect((await rtCall('/bridge/status')).status).toBe(200);
  });
});
