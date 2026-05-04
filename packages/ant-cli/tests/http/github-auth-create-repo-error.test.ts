import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubAuthService, GitHubRepoCreateError } from '../../src/periphery/adapters/auth/GitHubAuthService';

const USER_CONTEXT = {
  organizationId: 'to.nexus',
  userId: 'probe',
  email: 'probe@example.com',
};

describe('GitHubAuthService.createRepo error diagnostics', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('includes status, request id, and details for GitHub JSON failures', async () => {
    const service = new GitHubAuthService('/tmp');
    vi.spyOn(service, 'getPAT').mockResolvedValue('github_pat_test');

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ type: 'Organization' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            message: 'Validation Failed',
            documentation_url: 'https://docs.github.com/rest/repos/repos#create-an-organization-repository',
            errors: [{ message: 'name already exists on this account', code: 'custom' }],
          }),
          {
            status: 422,
            headers: {
              'Content-Type': 'application/json',
              'x-github-request-id': 'REQ-422-TEST',
            },
          }
        )
      );

    vi.stubGlobal('fetch', fetchMock);

    const thrown = await service.createRepo(USER_CONTEXT as any, 'to-nexus/gamehub-fe')
      .then(() => null)
      .catch((error) => error as GitHubRepoCreateError);

    expect(thrown).toMatchObject({
      name: 'GitHubRepoCreateError',
      statusCode: 422,
      requestId: 'REQ-422-TEST',
      apiMessage: 'Validation Failed',
      details: ['name already exists on this account / custom'],
    } satisfies Partial<GitHubRepoCreateError>);
    expect(thrown.message).toContain('[HTTP 422, request_id=REQ-422-TEST]');
  });

  it('falls back to status text when response body is not JSON', async () => {
    const service = new GitHubAuthService('/tmp');
    vi.spyOn(service, 'getPAT').mockResolvedValue('github_pat_test');

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ type: 'Organization' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response('upstream exploded', {
          status: 500,
          statusText: 'Internal Server Error',
          headers: {
            'Content-Type': 'text/plain',
            'x-github-request-id': 'REQ-500-TEST',
          },
        })
      );

    vi.stubGlobal('fetch', fetchMock);

    const thrown = await service.createRepo(USER_CONTEXT as any, 'to-nexus/gamehub-fe')
      .then(() => null)
      .catch((error) => error as GitHubRepoCreateError);

    expect(thrown).toBeInstanceOf(GitHubRepoCreateError);
    expect(thrown.statusCode).toBe(500);
    expect(thrown.requestId).toBe('REQ-500-TEST');
    expect(thrown.apiMessage).toBe('Internal Server Error');
    expect(thrown.details).toEqual([]);
  });
});
