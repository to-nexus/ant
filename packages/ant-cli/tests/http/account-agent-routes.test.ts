/**
 * Account-scoped agent settings routes (`/api/account/agents`) — CRUD,
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
import type { WorkspaceResolver } from '../../src/core/config/WorkspacePathResolver';
import type { OrganizationRepositoryPort } from '../../src/core/ports/organizationRepository';
import type { OrgMembershipRole } from '@ant/shared';

let wsRoot: string;
let userDir: string;
let server: http.Server;
let baseUrl: string;

function api(pathname: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}/api/account/agents${pathname}`, {
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
    '/api/account/agents',
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

  it('agent scaffold is intents-free (job-only); job scaffold includes intents.yaml', async () => {
    await createAgent();
    expect(fs.existsSync(path.join(userDir, '.ant/agents/ops/intents.yaml'))).toBe(false);
    expect(fs.existsSync(path.join(userDir, '.ant/agents/ops/injections'))).toBe(false);

    const jobRes = await api('/ops/jobs', { method: 'POST', body: JSON.stringify({ id: 'weekly', name: 'Weekly' }) });
    expect(jobRes.status).toBe(201);
    expect(fs.existsSync(path.join(userDir, '.ant/agents/ops/jobs/weekly/job.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(userDir, '.ant/agents/ops/jobs/weekly/intents.yaml'))).toBe(true);

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
    ['agent-level intents.yaml', 'intents.yaml', /intents are job-only/],
    ['agent-level injections file', 'injections/style.md', /save the file under jobs/],
  ] as const)('PUT legacy path: %s → 400 with move instruction', async (_label, relPath, pattern) => {
    const res = await api('/ops/file', { method: 'PUT', body: JSON.stringify({ path: relPath, content: 'x' }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(pattern);
  });

  it('PUT intents contract violation → 400 pre-write gate, NOT written', async () => {
    await api('/ops/jobs', { method: 'POST', body: JSON.stringify({ id: 'weekly', name: 'W' }) });
    // Structurally valid yaml, but the catalog contract is enforced pre-write:
    // reserved `general` intent must be a hard 400, not saved-with-warnings.
    const res = await api('/ops/file', {
      method: 'PUT',
      body: JSON.stringify({
        path: 'jobs/weekly/intents.yaml',
        content: 'version: 1\nintents:\n  - id: general\n    description: nope\n',
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/implicit fallback/);
    expect(fs.readFileSync(path.join(userDir, '.ant/agents/ops/jobs/weekly/intents.yaml'), 'utf-8')).not.toContain('general');
  });

  it('PUT semantic error → 200 SAVED with validation.errors warnings', async () => {
    await api('/ops/jobs', { method: 'POST', body: JSON.stringify({ id: 'weekly', name: 'W' }) });
    // Catalog-valid but the referenced injection file does not exist — a
    // cross-file condition the pre-write gate cannot see; post-write dry run
    // reports it as a warning while the file stays on disk.
    const res = await api('/ops/file', {
      method: 'PUT',
      body: JSON.stringify({
        path: 'jobs/weekly/intents.yaml',
        content: 'version: 1\nintents:\n  - id: review\n    description: review things\n    injections: [ghost.md]\n',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.validation.valid).toBe(false);
    expect(body.validation.errors.join('\n')).toMatch(/does not exist in the .* injections set/);
    // The file IS on disk (fix continues in the editor).
    expect(fs.readFileSync(path.join(userDir, '.ant/agents/ops/jobs/weekly/intents.yaml'), 'utf-8')).toContain('ghost.md');
  });

  it('PUT valid intents.yaml → 200, validation.valid true', async () => {
    await api('/ops/jobs', { method: 'POST', body: JSON.stringify({ id: 'weekly', name: 'W' }) });
    fs.mkdirSync(path.join(userDir, '.ant/agents/ops/jobs/weekly/injections'), { recursive: true });
    fs.writeFileSync(path.join(userDir, '.ant/agents/ops/jobs/weekly/injections/style.md'), 'Style prose.');
    const res = await api('/ops/file', {
      method: 'PUT',
      body: JSON.stringify({
        path: 'jobs/weekly/intents.yaml',
        content: 'version: 1\nintents:\n  - id: research\n    description: research things\n    injections: [style.md]\n',
      }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).validation).toEqual({ valid: true, errors: [] });
  });

  it('structural files cannot be deleted or renamed (delete the agent/job instead)', async () => {
    expect((await api('/ops/file?path=agent.yaml', { method: 'DELETE' })).status).toBe(400);
    const rename = await api('/ops/files/rename', {
      method: 'POST',
      body: JSON.stringify({ path: 'agent.yaml', newName: 'other.yaml' }),
    });
    expect(rename.status).toBe(400);
  });

  it('create + delete a whitelisted file round-trips', async () => {
    await api('/ops/jobs', { method: 'POST', body: JSON.stringify({ id: 'weekly', name: 'W' }) });
    const rel = 'jobs/weekly/injections/extra.md';
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

describe('folder import', () => {
  it('missing agent.yaml → 400; valid folder → 201 with skip-with-reason for off-whitelist files', async () => {
    const form = new FormData();
    form.append('files', new Blob(['# base']), 'system.md');
    form.append('relativePaths', 'imported/base/system.md');
    const missing = await fetch(`${baseUrl}/api/account/agents/import`, { method: 'POST', body: form });
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
    const ok = await fetch(`${baseUrl}/api/account/agents/import`, { method: 'POST', body: full });
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

  it('importing a folder named after a builtin agent → 409 (no silent shadowing)', async () => {
    const form = new FormData();
    form.append('files', new Blob(['id: assistant\nname: Mine\n']), 'agent.yaml');
    form.append('relativePaths', 'assistant/agent.yaml');
    const res = await fetch(`${baseUrl}/api/account/agents/import`, { method: 'POST', body: form });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/built-in/);
    expect(fs.existsSync(path.join(userDir, '.ant/agents/assistant'))).toBe(false);
  });
});

describe('prompt preview', () => {
  beforeEach(async () => {
    await createAgent();
    await api('/ops/jobs', { method: 'POST', body: JSON.stringify({ id: 'weekly', name: 'W' }) });
    fs.mkdirSync(path.join(userDir, '.ant/agents/ops/jobs/weekly/injections'), { recursive: true });
    fs.writeFileSync(path.join(userDir, '.ant/agents/ops/jobs/weekly/injections/style.md'), 'STYLE-BODY sentinel.');
    fs.writeFileSync(
      path.join(userDir, '.ant/agents/ops/jobs/weekly/intents.yaml'),
      'version: 1\nintents:\n  - id: research\n    description: research things\n    injections: [style.md]\n',
    );
  });

  it('returns the composed block; intents flip a file between toc and inlined', async () => {
    const tocOnly = await (await api('/ops/jobs/weekly/prompt-preview')).json();
    expect(tocOnly.system).toContain('<custom_job_instructions id="ops/weekly"');
    expect(tocOnly.inlined).toEqual([]);
    expect(tocOnly.toc).toEqual(['style.md']);
    expect(tocOnly.harnessTemplates.length).toBe(3);

    const active = await (await api('/ops/jobs/weekly/prompt-preview?intents=research')).json();
    expect(active.activeIntents).toEqual(['research']);
    expect(active.inlined).toEqual(['style.md']);
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
    return fetch(`${teamBaseUrl}/api/account/agents${pathname}`, {
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
      '/api/account/agents',
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
