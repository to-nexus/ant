/**
 * OperationDispatcher FSM tests.
 *
 * The dispatcher guarantees:
 *   - single-flight: concurrent `dispatch` calls collapse into one execution.
 *   - terminal statuses are `succeeded` | `failed`; `idle` is the only
 *     state reachable via `reset()`.
 *   - timeouts transition the state to `failed` with a descriptive error.
 */

import { describe, it, expect, vi } from 'vitest';
import { OperationDispatcher } from '../../src/common/operation/OperationDispatcher';

describe('OperationDispatcher', () => {
  it('starts in idle state', () => {
    const d = new OperationDispatcher<number>({ run: async () => 42 });
    expect(d.getState().status).toBe('idle');
  });

  it('transitions idle -> running -> succeeded on successful dispatch', async () => {
    const observer = vi.fn();
    const d = new OperationDispatcher<string>({
      run: async () => 'ok',
      onStateChange: observer,
    });

    const promise = d.dispatch();
    expect(d.getState().status).toBe('running');

    const final = await promise;
    expect(final.status).toBe('succeeded');
    if (final.status === 'succeeded') expect(final.result).toBe('ok');

    const statuses = observer.mock.calls.map((c) => (c[0] as any).status);
    expect(statuses).toContain('running');
    expect(statuses).toContain('succeeded');
  });

  it('transitions idle -> running -> failed on thrown error', async () => {
    const d = new OperationDispatcher<void>({
      run: async () => {
        throw new Error('boom');
      },
    });
    const final = await d.dispatch();
    expect(final.status).toBe('failed');
    if (final.status === 'failed') expect(final.error.message).toBe('boom');
  });

  it('single-flights concurrent dispatches by default', async () => {
    let runs = 0;
    const d = new OperationDispatcher<number>({
      run: async () => {
        runs++;
        await new Promise((r) => setTimeout(r, 20));
        return runs;
      },
    });
    const [a, b, c] = await Promise.all([d.dispatch(), d.dispatch(), d.dispatch()]);
    expect(runs).toBe(1);
    expect(a.status).toBe('succeeded');
    expect(b.status).toBe('succeeded');
    expect(c.status).toBe('succeeded');
  });

  it('transitions to failed when timeoutMs is exceeded', async () => {
    const d = new OperationDispatcher<void>({
      run: () => new Promise((resolve) => setTimeout(resolve, 100)),
      timeoutMs: 10,
    });
    const final = await d.dispatch();
    expect(final.status).toBe('failed');
    if (final.status === 'failed') {
      expect(final.error.message).toMatch(/timed out/i);
    }
  });

  it('reset() returns state to idle', async () => {
    const d = new OperationDispatcher<number>({ run: async () => 1 });
    await d.dispatch();
    expect(d.getState().status).toBe('succeeded');
    d.reset();
    expect(d.getState().status).toBe('idle');
  });
});
