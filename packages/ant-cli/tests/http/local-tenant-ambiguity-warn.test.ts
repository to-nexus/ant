import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  extractUserContext,
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

    const warnText = warnSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
    expect(warnText).toMatch(/ambiguous/i);
    const ambiguityWarns = warnSpy.mock.calls.filter((c: unknown[]) => /ambiguous/i.test(String(c[0])));
    expect(ambiguityWarns).toHaveLength(1);
  });

  it('warns when a single org has multiple users', () => {
    mkdirSync(path.join(base, 'orgA', 'u1'), { recursive: true });
    mkdirSync(path.join(base, 'orgA', 'u2'), { recursive: true });

    expect(inferLocalDefaultTenant()).toBeNull();
    expect(warnSpy.mock.calls.some((c: unknown[]) => /ambiguous/i.test(String(c[0])))).toBe(true);
  });

  it('does NOT warn for a clean single-org / single-user workspace', () => {
    mkdirSync(path.join(base, 'orgA', 'u1'), { recursive: true });

    expect(inferLocalDefaultTenant()).toEqual({ organizationId: 'orgA', userId: 'u1' });
    expect(warnSpy.mock.calls.some((c: unknown[]) => /ambiguous/i.test(String(c[0])))).toBe(false);
  });

  // An authored tenant is the escape hatch from directory-count-driven identity:
  // it wins over the probe, so an ambiguous tree stops being a problem.
  it('an authored ANT_LOCAL_ORG + ANT_LOCAL_USER wins over an ambiguous tree, without warning', () => {
    mkdirSync(path.join(base, 'orgA', 'u1'), { recursive: true });
    mkdirSync(path.join(base, 'orgA', 'u2'), { recursive: true });
    vi.stubEnv('ANT_LOCAL_ORG', 'orgA');
    vi.stubEnv('ANT_LOCAL_USER', 'u2');

    expect(inferLocalDefaultTenant()).toEqual({ organizationId: 'orgA', userId: 'u2' });
    expect(warnSpy.mock.calls.some((c: unknown[]) => /ambiguous/i.test(String(c[0])))).toBe(false);
    vi.unstubAllEnvs();
  });

  it('a half-declared tenant is ignored — one env var alone is a typo, not a default', () => {
    mkdirSync(path.join(base, 'orgA', 'u1'), { recursive: true });
    mkdirSync(path.join(base, 'orgA', 'u2'), { recursive: true });
    vi.stubEnv('ANT_LOCAL_ORG', 'orgA');

    expect(inferLocalDefaultTenant()).toBeNull();
    expect(warnSpy.mock.calls.some((c: unknown[]) => /ambiguous/i.test(String(c[0])))).toBe(true);
    vi.unstubAllEnvs();
  });
});

/**
 * `local/local/<project>` is the directory every ambiguous fallback lands in, so
 * project-id inference has to be able to find it. It previously probed a
 * hard-coded legacy `local/user/<project>` shape and could never match.
 */
describe('project-id tenant inference covers the local fallback tenant', () => {
  let base: string;
  let origBase: string | undefined;
  let origMode: string | undefined;

  beforeEach(() => {
    base = mkdtempSync(path.join(os.tmpdir(), 'ant-tenant-byproject-'));
    origBase = process.env.ANT_WORKSPACE_BASE_PATH;
    origMode = process.env.ANT_SERVER_MODE;
    process.env.ANT_WORKSPACE_BASE_PATH = base;
    delete process.env.ANT_SERVER_MODE;
    __resetInferredLocalDefaultForTests();
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
    if (origBase === undefined) delete process.env.ANT_WORKSPACE_BASE_PATH;
    else process.env.ANT_WORKSPACE_BASE_PATH = origBase;
    if (origMode === undefined) delete process.env.ANT_SERVER_MODE;
    else process.env.ANT_SERVER_MODE = origMode;
    __resetInferredLocalDefaultForTests();
  });

  it('resolves a project under local/local even when another org is ambiguous', () => {
    mkdirSync(path.join(base, 'local', 'local', 'ws-pilot'), { recursive: true });
    mkdirSync(path.join(base, 'orgA', 'u1'), { recursive: true });
    mkdirSync(path.join(base, 'orgA', 'u2'), { recursive: true });

    const req = { params: { id: 'ws-pilot' } } as any;
    expect(extractUserContext(req)).toEqual({
      organizationId: 'local',
      userId: 'local',
      organizationKind: 'local',
    });
  });

  it('resolves a project under a named org/user tenant', () => {
    mkdirSync(path.join(base, 'to.nexus', 'probe', 'landing'), { recursive: true });
    mkdirSync(path.join(base, 'to.nexus', 'drone', 'other'), { recursive: true });

    const req = { params: { id: 'landing' } } as any;
    expect(extractUserContext(req)).toEqual({
      organizationId: 'to.nexus',
      userId: 'probe',
      organizationKind: 'local',
    });
  });
});
