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
import { createAccountAgentRoutes } from '../../src/periphery/adapters/http/routes/accountAgents.routes';
import type { WorkspaceResolver } from '../../src/core/config/WorkspacePathResolver';

let userDir: string;
let server: http.Server;
let baseUrl: string;

function api(pathname: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}/api/account/agents${pathname}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

beforeAll(async () => {
  userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-account-agents-'));
  const resolver = {
    getWorkspacePath: () => userDir,
  } as unknown as WorkspaceResolver;

  const app = express();
  app.use(express.json());
  app.use('/api/account/agents', createAccountAgentRoutes({ workspaceResolver: resolver }));
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  fs.rmSync(userDir, { recursive: true, force: true });
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
  it('GET / returns agents + builtinToolPreset (form vocabulary from the runtime SSOT)', async () => {
    const res = await api('');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.agents)).toBe(true);
    expect(body.builtinToolPreset.length).toBeGreaterThan(0);
    // Shipped builtin samples are visible without a project.
    expect(body.agents.some((a: any) => a.scope === 'builtin')).toBe(true);
  });

  it('agent scaffold includes intents.yaml; job CRUD mirrors project-scoped semantics', async () => {
    await createAgent();
    expect(fs.existsSync(path.join(userDir, '.ant/agents/ops/intents.yaml'))).toBe(true);

    const jobRes = await api('/ops/jobs', { method: 'POST', body: JSON.stringify({ id: 'weekly', name: 'Weekly' }) });
    expect(jobRes.status).toBe(201);
    expect(fs.existsSync(path.join(userDir, '.ant/agents/ops/jobs/weekly/job.yaml'))).toBe(true);

    const patch = await api('/ops/jobs/weekly', { method: 'PATCH', body: JSON.stringify({ description: 'd' }) });
    expect(patch.status).toBe(200);

    const del = await api('/ops/jobs/weekly', { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(fs.existsSync(path.join(userDir, '.ant/agents/ops/jobs/weekly'))).toBe(false);
  });

  it('readonly scope (builtin) mutations → 403', async () => {
    const res = await api('/sample-researcher', { method: 'PATCH', body: JSON.stringify({ name: 'x' }) });
    expect(res.status).toBe(403);
  });

  it('unknown agent → 404; invalid id → 400', async () => {
    expect((await api('/ghost', { method: 'DELETE' })).status).toBe(404);
    expect((await api('/Bad_Id', { method: 'DELETE' })).status).toBe(400);
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
    expect(names).toContain('intents.yaml');

    const file = await (await api('/ops/file?path=agent.yaml')).json();
    expect(file.content).toContain('id: ops');

    const builtinTree = await api('/sample-researcher/files');
    expect(builtinTree.status).toBe(200);
    expect((await builtinTree.json()).readonly).toBe(true);
  });

  it.each([
    ['YAML syntax error → 400, NOT written', 'agent.yaml', 'id: [unclosed', 400],
    ['agent.yaml id ≠ dir name → 400, NOT written', 'agent.yaml', 'id: not-ops\nname: x\ndescription: ""\n', 400],
    ['whitelist violation → 400', 'random/deep/file.md', 'x', 400],
    ['traversal → whitelist 400', '../escape.md', 'x', 400],
  ] as const)('PUT gate: %s', async (_label, relPath, content, expectedStatus) => {
    const before = fs.readFileSync(path.join(userDir, '.ant/agents/ops/agent.yaml'), 'utf-8');
    const res = await api('/ops/file', { method: 'PUT', body: JSON.stringify({ path: relPath, content }) });
    expect(res.status).toBe(expectedStatus);
    expect(fs.readFileSync(path.join(userDir, '.ant/agents/ops/agent.yaml'), 'utf-8')).toBe(before);
  });

  it('PUT semantic error → 200 SAVED with validation.errors warnings', async () => {
    await api('/ops/jobs', { method: 'POST', body: JSON.stringify({ id: 'weekly', name: 'W' }) });
    // Structurally valid yaml, semantically broken: reserved `general` intent.
    const res = await api('/ops/file', {
      method: 'PUT',
      body: JSON.stringify({
        path: 'intents.yaml',
        content: 'version: 1\nintents:\n  - id: general\n    description: nope\n',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.validation.valid).toBe(false);
    expect(body.validation.errors.join('\n')).toMatch(/implicit fallback/);
    // The file IS on disk (fix continues in the editor).
    expect(fs.readFileSync(path.join(userDir, '.ant/agents/ops/intents.yaml'), 'utf-8')).toContain('general');
  });

  it('PUT valid intents.yaml → 200, validation.valid true', async () => {
    await api('/ops/jobs', { method: 'POST', body: JSON.stringify({ id: 'weekly', name: 'W' }) });
    fs.mkdirSync(path.join(userDir, '.ant/agents/ops/injections'), { recursive: true });
    fs.writeFileSync(path.join(userDir, '.ant/agents/ops/injections/style.md'), 'Style prose.');
    const res = await api('/ops/file', {
      method: 'PUT',
      body: JSON.stringify({
        path: 'intents.yaml',
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
    const create = await api('/ops/files/create', { method: 'POST', body: JSON.stringify({ path: 'injections/extra.md' }) });
    expect(create.status).toBe(200);
    expect(fs.existsSync(path.join(userDir, '.ant/agents/ops/injections/extra.md'))).toBe(true);
    const del = await api('/ops/file?path=injections/extra.md', { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(fs.existsSync(path.join(userDir, '.ant/agents/ops/injections/extra.md'))).toBe(false);
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
    full.append('files', new Blob(['id: imported\nname: Imported\ndescription: ""\n']), 'agent.yaml');
    full.append('relativePaths', 'imported/agent.yaml');
    full.append('files', new Blob(['# base']), 'system.md');
    full.append('relativePaths', 'imported/base/system.md');
    full.append('files', new Blob(['skip me']), 'notes.txt');
    full.append('relativePaths', 'imported/random/notes.txt');
    const ok = await fetch(`${baseUrl}/api/account/agents/import`, { method: 'POST', body: full });
    expect(ok.status).toBe(201);
    const body = await ok.json();
    expect(body.agentId).toBe('imported');
    expect(body.uploaded).toContain('agent.yaml');
    expect(body.skipped).toEqual([{ path: 'imported/random/notes.txt', reason: 'outside the definition whitelist' }]);
    expect(fs.existsSync(path.join(userDir, '.ant/agents/imported/base/system.md'))).toBe(true);
  });
});
