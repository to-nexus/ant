/**
 * GitHub commit-attribution identity.
 *
 * Root cause fixed here: ant wrote a synthetic `${userId}@${organizationId}`
 * author email that matches no verified GitHub email, so GitHub rendered a
 * generic avatar with no username link for the PAT owner. The fix resolves the
 * PAT owner's real GitHub identity (public email, else the `{id}+{login}`
 * noreply address) and:
 *   1. `ensureUserConfig` writes it, overwriting the synthetic value but never a
 *      user-set real identity.
 *   2. `getCommitIdentity` builds the noreply address when the public email is
 *      private/null.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { SimpleGit } from 'simple-git';
import { GitHelper } from '../../src/periphery/adapters/http/services/GitService/helper/GitHelper';
import { GitHubAuthService } from '../../src/periphery/adapters/auth/GitHubAuthService';
import type { GitHubCredentials } from '../../src/utils/userConfig';
import type { UserContext } from '../../src/core/types/user';

const USER: UserContext = { organizationId: 'individual', userId: 'probe@to.nexus' };
const SYNTHETIC_EMAIL = `${USER.userId}@${USER.organizationId}`; // probe@to.nexus@individual
const IDENTITY = { name: 'probe', email: '12345+probe@users.noreply.github.com' };

/** Minimal SimpleGit fake recording config reads/writes. */
function fakeGit(initial: { email?: string; name?: string }) {
  const store: { [k: string]: string | undefined } = {
    'user.email': initial.email,
    'user.name': initial.name,
  };
  const writes: Array<{ key: string; value: string }> = [];
  const git = {
    async raw(args: string[]): Promise<string> {
      if (args[0] === 'config') {
        const v = store[args[1]];
        if (v === undefined) throw new Error('not set');
        return `${v}\n`;
      }
      return '';
    },
    async addConfig(key: string, value: string): Promise<void> {
      store[key] = value;
      writes.push({ key, value });
    },
  };
  return { git: git as unknown as SimpleGit, store, writes };
}

describe('ensureUserConfig — identity write discipline', () => {
  it('overwrites a synthetic email/name with the real GitHub identity', async () => {
    const { git, store } = fakeGit({ email: SYNTHETIC_EMAIL, name: USER.userId });
    await GitHelper.ensureUserConfig(git, USER, IDENTITY);
    expect(store['user.email']).toBe(IDENTITY.email);
    expect(store['user.name']).toBe(IDENTITY.name);
  });

  it('preserves a real user-set email — never clobbers it', async () => {
    const { git, store, writes } = fakeGit({ email: 'real@person.dev', name: 'Real Person' });
    await GitHelper.ensureUserConfig(git, USER, IDENTITY);
    expect(store['user.email']).toBe('real@person.dev');
    expect(store['user.name']).toBe('Real Person');
    expect(writes).toHaveLength(0);
  });

  it('sets the GitHub identity when nothing is configured yet', async () => {
    const { git, store } = fakeGit({});
    await GitHelper.ensureUserConfig(git, USER, IDENTITY);
    expect(store['user.email']).toBe(IDENTITY.email);
    expect(store['user.name']).toBe(IDENTITY.name);
  });

  it('falls back to the synthetic identity when no GitHub identity is available', async () => {
    const { git, store } = fakeGit({});
    await GitHelper.ensureUserConfig(git, USER, undefined);
    expect(store['user.email']).toBe(SYNTHETIC_EMAIL);
    expect(store['user.name']).toBe(USER.userId);
  });
});

describe('getCommitIdentity — noreply construction', () => {
  it('builds {id}+{login}@users.noreply.github.com when public email is absent', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-gh-'));
    try {
      const service = new GitHubAuthService(root);
      // Seed stored credentials with login + id but NO public email (private).
      const store = (service as unknown as {
        userConfig: { credentials: { set: (c: unknown, k: string, v: Omit<GitHubCredentials, 'updatedAt'>) => Promise<void> } };
      }).userConfig.credentials;
      await store.set(
        { organizationId: USER.organizationId, userId: USER.userId },
        'github',
        {
          token: 'ghp_stubtokenstubtokenstubtoken',
          tokenType: 'pat',
          username: 'probe',
          githubUserId: 12345,
        },
      );

      const identity = await service.getCommitIdentity({ org: USER.organizationId, user: USER.userId });
      expect(identity).toEqual({ name: 'probe', email: '12345+probe@users.noreply.github.com' });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('prefers a stored public email over the noreply address', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-gh-'));
    try {
      const service = new GitHubAuthService(root);
      const store = (service as unknown as {
        userConfig: { credentials: { set: (c: unknown, k: string, v: Omit<GitHubCredentials, 'updatedAt'>) => Promise<void> } };
      }).userConfig.credentials;
      await store.set(
        { organizationId: USER.organizationId, userId: USER.userId },
        'github',
        {
          token: 'ghp_stubtokenstubtokenstubtoken',
          tokenType: 'pat',
          username: 'probe',
          githubUserId: 12345,
          email: 'probe@public.dev',
        },
      );

      const identity = await service.getCommitIdentity({ org: USER.organizationId, user: USER.userId });
      expect(identity).toEqual({ name: 'probe', email: 'probe@public.dev' });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns null when no PAT is configured', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-gh-'));
    try {
      const service = new GitHubAuthService(root);
      const identity = await service.getCommitIdentity({ org: USER.organizationId, user: USER.userId });
      expect(identity).toBeNull();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
