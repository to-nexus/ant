import { describe, expect, it } from 'vitest';

import { applyCodeCommandPolicy } from '../../src/agents/common/tool/handlers/codeCommandPolicy';
import type { ToolExecutionContext } from '../../src/agents/common/tool/types';

const ctx = (allow: boolean): ToolExecutionContext =>
  ({ fileSystem: {} as any, chatStatus: {} as any, workingDir: '/tmp', allowPersistentProcesses: allow }) as any;

describe('dev-server backgrounding guard', () => {
  it('rejects `pnpm dev &` when persistent processes are unlocked, pointing to keep_running + http_request', () => {
    const r = applyCodeCommandPolicy(ctx(true), { command: 'PORT=3333 pnpm --filter app dev &\nsleep 10 && echo READY' });
    expect(r).not.toBeNull();
    expect(r!.content).toContain('[Policy]');
    expect(r!.content).toContain('keep_running');
    expect(r!.content).toContain('http_request');
  });

  it('rejects `nohup next dev`', () => {
    const r = applyCodeCommandPolicy(ctx(true), { command: 'nohup next dev > /tmp/out.log' });
    expect(r).not.toBeNull();
  });

  it('allows a plain `pnpm dev` (managed via keep_running elsewhere)', () => {
    expect(applyCodeCommandPolicy(ctx(true), { command: 'pnpm dev' })).toBeNull();
  });

  it('also fires when persistent processes are locked, pointing to the bounded keep_running:false probe', () => {
    const r = applyCodeCommandPolicy(ctx(false), { command: 'pnpm dev &' });
    expect(r).not.toBeNull();
    expect(r!.content).toContain('[Policy]');
    expect(r!.content).toContain('keep_running: false');
    // Locked message must NOT advertise http_request (it is unavailable here).
    expect(r!.content).not.toContain('http_request');
  });

  it('does NOT misfire on a chained `&&` dev command', () => {
    expect(applyCodeCommandPolicy(ctx(true), { command: 'pnpm install && pnpm dev' })).toBeNull();
  });

  it('does NOT misfire on a non-server background job like `make build & wait`', () => {
    expect(applyCodeCommandPolicy(ctx(true), { command: 'make build & wait' })).toBeNull();
  });
});

describe('persistent keep_running gate (set-gated with http_request)', () => {
  it('rejects keep_running:true when persistent processes are locked, pointing to the bounded probe', () => {
    const r = applyCodeCommandPolicy(ctx(false), { command: 'pnpm dev', keep_running: true });
    expect(r).not.toBeNull();
    expect(r!.content).toContain('[Policy]');
    expect(r!.content).toContain('keep_running: false');
  });

  it('allows keep_running:true when persistent processes are unlocked', () => {
    expect(applyCodeCommandPolicy(ctx(true), { command: 'pnpm dev', keep_running: true })).toBeNull();
  });

  it('allows the bounded keep_running:false probe regardless of the gate', () => {
    expect(applyCodeCommandPolicy(ctx(false), { command: 'pnpm dev', keep_running: false })).toBeNull();
    expect(applyCodeCommandPolicy(ctx(true), { command: 'pnpm dev', keep_running: false })).toBeNull();
  });
});
