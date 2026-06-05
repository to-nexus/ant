import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

import { handleHttpRequest } from '../../src/agents/common/tool/handlers/httpProbe';
import type { ToolExecutionContext } from '../../src/agents/common/tool/types';

let server: http.Server;
let port: number;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    res.statusCode = req.url === '/ok' ? 200 : 404;
    res.setHeader('content-type', 'text/plain');
    res.end(req.url === '/ok' ? 'hello' : 'nope');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

function ctx(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    fileSystem: {} as any,
    chatStatus: {} as any,
    workingDir: '/tmp',
    allowPersistentProcesses: true,
    ...overrides,
  };
}

describe('handleHttpRequest', () => {
  it('gate off → [Policy] reject, no probe', async () => {
    const r = await handleHttpRequest(ctx({ allowPersistentProcesses: false }), { url: '/ok' });
    expect(r.content).toContain('[Policy]');
    expect(r.sideEffects).toEqual([]);
  });

  it('absolute url → fact report with status + body, no verdict glyphs', async () => {
    const r = await handleHttpRequest(ctx(), { url: `http://127.0.0.1:${port}/ok` });
    const content = r.content as string;
    expect(content).toContain('status: 200');
    expect(content).toContain('hello');
    expect(content).not.toMatch(/✅|❌/);
    // Read-only — no side effects.
    expect(r.sideEffects).toEqual([]);
  });

  it('relative path auto-targets the most-recently-started server port', async () => {
    const r = await handleHttpRequest(
      ctx({
        runningServers: [
          { pid: 1, command: 'old', workingDir: '/tmp', port: 9, startedAt: 1 },
          { pid: 2, command: 'pnpm dev', workingDir: '/tmp', port, startedAt: 2 },
        ],
      }),
      { url: '/ok' },
    );
    const content = r.content as string;
    expect(content).toContain(`url: http://localhost:${port}/ok`);
    expect(content).toContain('status: 200');
  });

  it('no server + relative path + no port → instructive fact (no crash)', async () => {
    const r = await handleHttpRequest(ctx({ runningServers: [] }), { url: '/ok' });
    expect(r.content).toContain('No running dev server');
    expect(r.sideEffects).toEqual([]);
  });

  it('explicit port overrides auto-resolution', async () => {
    const r = await handleHttpRequest(ctx(), { url: '/ok', port });
    expect(r.content as string).toContain(`url: http://localhost:${port}/ok`);
  });
});
