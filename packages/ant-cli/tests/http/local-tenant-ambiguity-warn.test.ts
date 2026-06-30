import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  inferLocalDefaultTenant,
  __resetInferredLocalDefaultForTests,
} from '../../src/periphery/adapters/http/routes/helpers/userContext';
import { logger } from '../../src/utils/logger';

/**
 * O9 (security hardening P4) — local-mode tenant inference is only safe with a
 * single org/user. With multiple tenants the inference is ambiguous and falls
 * back to the `local` tenant; this must emit a one-time security warning.
 */
describe('local-mode multi-tenant ambiguity warning', () => {
  let base: string;
  let origBase: string | undefined;
  let origMode: string | undefined;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    base = mkdtempSync(path.join(os.tmpdir(), 'ant-tenant-warn-'));
    origBase = process.env.ANT_WORKSPACE_BASE_PATH;
    origMode = process.env.ANT_SERVER_MODE;
    process.env.ANT_WORKSPACE_BASE_PATH = base;
    delete process.env.ANT_SERVER_MODE; // default → local mode
    __resetInferredLocalDefaultForTests();
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as any);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    rmSync(base, { recursive: true, force: true });
    if (origBase === undefined) delete process.env.ANT_WORKSPACE_BASE_PATH;
    else process.env.ANT_WORKSPACE_BASE_PATH = origBase;
    if (origMode === undefined) delete process.env.ANT_SERVER_MODE;
    else process.env.ANT_SERVER_MODE = origMode;
    __resetInferredLocalDefaultForTests();
  });

  it('warns once when multiple org folders exist (ambiguous → null)', () => {
    mkdirSync(path.join(base, 'orgA', 'u1'), { recursive: true });
    mkdirSync(path.join(base, 'orgB', 'u1'), { recursive: true });

    expect(inferLocalDefaultTenant()).toBeNull();
    // Cached on second call — still no second warn.
    inferLocalDefaultTenant();

    const warnText = warnSpy.mock.calls.map(c => String(c[0])).join('\n');
    expect(warnText).toMatch(/ambiguous/i);
    const ambiguityWarns = warnSpy.mock.calls.filter(c => /ambiguous/i.test(String(c[0])));
    expect(ambiguityWarns).toHaveLength(1);
  });

  it('warns when a single org has multiple users', () => {
    mkdirSync(path.join(base, 'orgA', 'u1'), { recursive: true });
    mkdirSync(path.join(base, 'orgA', 'u2'), { recursive: true });

    expect(inferLocalDefaultTenant()).toBeNull();
    expect(warnSpy.mock.calls.some(c => /ambiguous/i.test(String(c[0])))).toBe(true);
  });

  it('does NOT warn for a clean single-org / single-user workspace', () => {
    mkdirSync(path.join(base, 'orgA', 'u1'), { recursive: true });

    expect(inferLocalDefaultTenant()).toEqual({ organizationId: 'orgA', userId: 'u1' });
    expect(warnSpy.mock.calls.some(c => /ambiguous/i.test(String(c[0])))).toBe(false);
  });
});
