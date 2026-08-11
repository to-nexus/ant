/**
 * A16 MCP credential plane — the encrypted per-user store bucket and its
 * store-only resolver.
 *
 * Two contracts:
 *   1. the `mcp` bucket is keyed data in credentials.json, encrypted like every
 *      other credential, and invisible to the ServiceType surface (`list()`).
 *   2. resolution reads ONLY the store — a key that happens to be set as a
 *      host env var still resolves to a miss, which is the exfiltration fix
 *      (a definition author controls `url` + key names; process.env fallback
 *      would let them name-and-leak platform secrets).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { INFRASTRUCTURE_INTERRUPTION_REASONS, isInfrastructureInterruption } from '@ant/shared';

import { CredentialsStore } from '../../src/utils/userConfig/CredentialsStore';
import { StoreBackedMcpCredentialResolver } from '../../src/utils/userConfig/StoreBackedMcpCredentialResolver';
import { McpConfigError, isMcpConfigError } from '../../src/core/customAgents/McpConfigError';
import type { UserContext } from '../../src/core/types/user';

const USER: UserContext = { organizationId: 'local', userId: 'local' } as UserContext;

describe('CredentialsStore — mcp bucket', () => {
  let root: string;
  let store: CredentialsStore;
  let originalKey: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'ant-mcp-cred-'));
    originalKey = process.env.ANT_ENCRYPTION_KEY;
    process.env.ANT_ENCRYPTION_KEY = 'a'.repeat(64);
    store = new CredentialsStore(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    if (originalKey === undefined) delete process.env.ANT_ENCRYPTION_KEY;
    else process.env.ANT_ENCRYPTION_KEY = originalKey;
  });

  it('set → get roundtrips the secret with kind and updatedAt', async () => {
    await store.setMcpSecret(USER, 'OPS_API_TOKEN', 'Bearer xyz');
    const cred = await store.getMcpSecret(USER, 'OPS_API_TOKEN');
    expect(cred).toMatchObject({ kind: 'static', value: 'Bearer xyz' });
    expect(cred?.updatedAt).toBeTruthy();
  });

  it('listMcpKeys exposes key + updatedAt and never the value', async () => {
    await store.setMcpSecret(USER, 'OPS_API_TOKEN', 'Bearer xyz');
    const keys = await store.listMcpKeys(USER);
    expect(keys).toHaveLength(1);
    expect(keys[0].key).toBe('OPS_API_TOKEN');
    expect(keys[0]).not.toHaveProperty('value');
  });

  it('deleteMcpSecret removes the key and leaves siblings intact', async () => {
    await store.setMcpSecret(USER, 'A_TOKEN', 'a');
    await store.setMcpSecret(USER, 'B_TOKEN', 'b');
    await store.deleteMcpSecret(USER, 'A_TOKEN');
    expect(await store.getMcpSecret(USER, 'A_TOKEN')).toBeUndefined();
    expect((await store.getMcpSecret(USER, 'B_TOKEN'))?.value).toBe('b');
  });

  it('the mcp bucket never appears in the ServiceType list()', async () => {
    await store.setMcpSecret(USER, 'OPS_API_TOKEN', 'Bearer xyz');
    expect(await store.list(USER)).not.toContain('mcp');
  });
});

describe('StoreBackedMcpCredentialResolver — store-only, no process.env fallback', () => {
  let root: string;
  let store: CredentialsStore;
  let originalKey: string | undefined;
  let originalProbe: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'ant-mcp-res-'));
    originalKey = process.env.ANT_ENCRYPTION_KEY;
    originalProbe = process.env.HOST_ONLY_SECRET;
    process.env.ANT_ENCRYPTION_KEY = 'a'.repeat(64);
    store = new CredentialsStore(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    if (originalKey === undefined) delete process.env.ANT_ENCRYPTION_KEY;
    else process.env.ANT_ENCRYPTION_KEY = originalKey;
    if (originalProbe === undefined) delete process.env.HOST_ONLY_SECRET;
    else process.env.HOST_ONLY_SECRET = originalProbe;
  });

  it('resolves a registered key to its stored value', async () => {
    await store.setMcpSecret(USER, 'OPS_API_TOKEN', 'Bearer xyz');
    const resolver = new StoreBackedMcpCredentialResolver(store, USER);
    expect(await resolver.resolve('OPS_API_TOKEN')).toBe('Bearer xyz');
  });

  it('a key set ONLY as a host env var is a miss — process.env is never consulted', async () => {
    process.env.HOST_ONLY_SECRET = 'leaked-if-read';
    const resolver = new StoreBackedMcpCredentialResolver(store, USER);
    expect(await resolver.resolve('HOST_ONLY_SECRET')).toBeUndefined();
  });

  it('is per-user: another user cannot resolve the key', async () => {
    await store.setMcpSecret(USER, 'OPS_API_TOKEN', 'Bearer xyz');
    const other = { organizationId: 'local', userId: 'someone-else' } as UserContext;
    const resolver = new StoreBackedMcpCredentialResolver(store, other);
    expect(await resolver.resolve('OPS_API_TOKEN')).toBeUndefined();
  });
});

describe('McpConfigError → config_invalid classification contract (A13)', () => {
  it('duck-types across realms like LlmAuthError', () => {
    expect(isMcpConfigError(new McpConfigError('x'))).toBe(true);
    expect(isMcpConfigError({ isMcpConfigError: true, message: 'x' })).toBe(true);
    expect(isMcpConfigError(new Error('x'))).toBe(false);
    expect(isMcpConfigError(undefined)).toBe(false);
  });

  it('config_invalid is NOT an infrastructure reason — no infra resume affordance', () => {
    expect(INFRASTRUCTURE_INTERRUPTION_REASONS).not.toContain('config_invalid');
    expect(isInfrastructureInterruption('config_invalid')).toBe(false);
  });
});
