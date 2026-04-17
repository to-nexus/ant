import { describe, it, expect } from 'vitest';
import { deriveInstallDecision } from '../../../src/agents/common/tool/handlers/invalidationScope';

describe('Axis A — deriveInstallDecision', () => {
  it('no saved hash + node_modules present → adopt disk hash (no install)', () => {
    const d = deriveInstallDecision(undefined, 'hash-A', true);
    expect(d.installNeeded).toBe(false);
    expect(d.adoptedHash).toBe('hash-A');
    expect(d.reason).toMatch(/inferred/);
  });

  it('no saved hash + node_modules missing → install needed (fresh project)', () => {
    const d = deriveInstallDecision(undefined, 'hash-A', false);
    expect(d.installNeeded).toBe(true);
    expect(d.adoptedHash).toBeUndefined();
  });

  it('no saved hash + no currentHash → install needed (no manifests)', () => {
    const d = deriveInstallDecision(undefined, null, true);
    expect(d.installNeeded).toBe(true);
    expect(d.adoptedHash).toBeUndefined();
  });

  it('saved hash matches + node_modules exists → cached (no install)', () => {
    const d = deriveInstallDecision('hash-A', 'hash-A', true);
    expect(d.installNeeded).toBe(false);
    expect(d.adoptedHash).toBeUndefined();
    expect(d.reason).toMatch(/cached/);
  });

  it('saved hash mismatch → install needed', () => {
    const d = deriveInstallDecision('hash-A', 'hash-B', true);
    expect(d.installNeeded).toBe(true);
    expect(d.reason).toMatch(/changed/);
  });

  it('saved hash matches but node_modules removed → install needed', () => {
    const d = deriveInstallDecision('hash-A', 'hash-A', false);
    expect(d.installNeeded).toBe(true);
    expect(d.reason).toMatch(/missing/);
  });

  it('parallel worker scenario: cold state + installed deps → reuse', () => {
    // Simulates scenario 6: a previous worker installed deps; the new
    // verification worker has no _depFileHash yet but sees node_modules on disk.
    const d = deriveInstallDecision(undefined, 'hash-current', true);
    expect(d.installNeeded).toBe(false);
    expect(d.adoptedHash).toBe('hash-current');
  });
});
