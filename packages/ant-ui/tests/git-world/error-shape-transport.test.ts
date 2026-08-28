/**
 * The error contract must survive the wire.
 *
 * `dispatchGitOp` rebuilds the error object field by field, so any field it
 * forgets is silently dropped — `retryAfterMs` already was, which is why the
 * lock-contention countdown could never render. `params` carries the branch
 * name and commit count the "remote is ahead" dialog interpolates; without it
 * the localized copy renders with empty placeholders.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const authFetch = vi.fn();

vi.mock('../../src/infrastructure/http/api/client', () => ({
  API_BASE: () => 'http://localhost/api',
  apiGet: vi.fn(),
  authFetch: (...args: unknown[]) => authFetch(...args),
}));

import { dispatchGitOp } from '../../src/domain/git-world/infrastructure/api';

function respond(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

beforeEach(() => {
  authFetch.mockReset();
});

describe('dispatchGitOp — error shape', () => {
  it('preserves suggestedAction, params and retryAfterMs', async () => {
    authFetch.mockResolvedValue(
      respond(409, {
        success: false,
        error: {
          kind: 'conflict',
          message: 'origin/main has 3 commit(s) this workspace does not have.',
          retryable: false,
          suggestedAction: 'syncFirst',
          params: { branch: 'main', count: 3 },
          retryAfterMs: 180000,
        },
      }),
    );

    const result = await dispatchGitOp('proj', { kind: 'push', feature: 'main' });

    expect(result.success).toBe(false);
    expect(result.success === false && result.error).toMatchObject({
      kind: 'conflict',
      suggestedAction: 'syncFirst',
      params: { branch: 'main', count: 3 },
      retryAfterMs: 180000,
    });
  });

  it('sends the op fields other than kind as the body', async () => {
    authFetch.mockResolvedValue(respond(200, { success: true }));

    await dispatchGitOp('proj', { kind: 'pull', feature: 'main', strategy: 'rebase' });

    const [url, init] = authFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/git/ops/pull');
    expect(JSON.parse(String(init.body))).toEqual({ feature: 'main', strategy: 'rebase' });
  });
});
