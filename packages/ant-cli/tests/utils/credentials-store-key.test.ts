import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { CredentialsStore } from '../../src/utils/userConfig/CredentialsStore';

/**
 * O6 (security hardening P4) — an explicitly-set but malformed
 * ANT_ENCRYPTION_KEY must fail fast rather than silently fall back to a
 * file / random key (which would encrypt credentials under a key the
 * operator never chose).
 */
describe('CredentialsStore encryption-key validation', () => {
  let root: string;
  let original: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'ant-cred-'));
    original = process.env.ANT_ENCRYPTION_KEY;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    if (original === undefined) delete process.env.ANT_ENCRYPTION_KEY;
    else process.env.ANT_ENCRYPTION_KEY = original;
  });

  it('throws when ANT_ENCRYPTION_KEY is set with an invalid length', () => {
    process.env.ANT_ENCRYPTION_KEY = 'abcd'; // far short of 64 hex chars
    expect(() => new CredentialsStore(root)).toThrow(/invalid length/);
  });

  it('throws when ANT_ENCRYPTION_KEY is set with non-hex characters', () => {
    process.env.ANT_ENCRYPTION_KEY = 'z'.repeat(64);
    expect(() => new CredentialsStore(root)).toThrow(/invalid characters/);
  });

  it('accepts a valid 64-hex-char key', () => {
    process.env.ANT_ENCRYPTION_KEY = 'a'.repeat(64);
    expect(() => new CredentialsStore(root)).not.toThrow();
  });

  it('falls back to a generated file key when the env var is unset (no throw)', () => {
    delete process.env.ANT_ENCRYPTION_KEY;
    expect(() => new CredentialsStore(root)).not.toThrow();
  });
});
