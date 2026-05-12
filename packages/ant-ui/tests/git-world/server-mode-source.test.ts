/**
 * `serverMode` SSOT regression guard.
 *
 * `ANT_SERVER_MODE` on the backend is the single source of truth for
 * the running mode. FE consumes it via `GET /system/config` → stored as
 * read-only `state.serverMode: AsyncFields<'local'|'cloud'>`. There is
 * no user-facing toggle, no localStorage stickiness, no origin-detection
 * helper, and no `/local` setup-guide route.
 *
 * This guard locks:
 *   1. `launchMode` / `setLaunchMode` / `determineInitialLaunchMode` /
 *      `isManagedBuild` / `checkLocalBackend` / `LocalSetupGuide` /
 *      `launchModeInit` / `LAUNCH_MODE_STORAGE_KEY` symbols are absent
 *      from `packages/ant-ui/src`.
 *   2. `configSlice` reads `authMode` from `/system/config` into
 *      `serverMode` and clears the legacy `'ant-ui:launch-mode'` key on
 *      slice init (one-shot migration).
 *   3. `SystemConfigResponse.authMode` is the typed contract.
 */

import { describe, it, expect } from 'vitest';
import { readdir, readFile } from 'fs/promises';
import * as path from 'path';

const SRC_ROOT = path.resolve(__dirname, '..', '..', 'src');
const SHARED_INDEX = path.resolve(__dirname, '..', '..', '..', 'ant-shared', 'src', 'system-config.ts');

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(full);
  }
  return out;
}

describe('serverMode SSOT — source-level guards', () => {
  it('no launch-mode toggle symbols survive in ant-ui/src', async () => {
    const banned = [
      'determineInitialLaunchMode',
      'setLaunchMode',
      'isManagedBuild',
      'checkLocalBackend',
      'LAUNCH_MODE_STORAGE_KEY',
      'LocalSetupGuide',
      'launchModeInit',
      'ServerModeBadge',
    ];
    const files = await walk(SRC_ROOT);
    const offenders: { file: string; symbol: string }[] = [];
    for (const f of files) {
      const body = await readFile(f, 'utf8');
      for (const symbol of banned) {
        if (body.includes(symbol)) {
          offenders.push({ file: path.relative(SRC_ROOT, f), symbol });
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no `state.launchMode` reads survive in ant-ui/src', async () => {
    const files = await walk(SRC_ROOT);
    const offenders: string[] = [];
    for (const f of files) {
      const body = await readFile(f, 'utf8');
      // Match `.launchMode` field reads (state.launchMode, params.launchMode, etc.)
      // The migration constant name `LEGACY_LAUNCH_MODE_KEYS` is allowed.
      const stripped = body.replace(/LEGACY_LAUNCH_MODE_KEYS/g, '');
      if (/\.launchMode\b/.test(stripped) || /\blaunchMode\s*[:,=]/.test(stripped)) {
        offenders.push(path.relative(SRC_ROOT, f));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('ConfigState carries `serverMode: AsyncFields<ServerMode>` (not `launchMode`)', async () => {
    const types = await readFile(path.join(SRC_ROOT, 'domain', 'store', 'types.ts'), 'utf8');
    expect(types).toMatch(/serverMode:\s*import\(.+\)\.AsyncFields<.+ServerMode>/);
    expect(types).not.toMatch(/launchMode:\s*'local'\s*\|\s*'cloud'/);
  });

  it('configSlice clears the legacy launch-mode localStorage key on init', async () => {
    const slice = await readFile(
      path.join(SRC_ROOT, 'domain', 'store', 'slices', 'configSlice.ts'),
      'utf8',
    );
    expect(slice).toMatch(/clearLegacyLaunchModeKeys/);
    expect(slice).toMatch(/'ant-ui:launch-mode'/);
    expect(slice).toMatch(/'ant-ui:backend-mode'/);
  });

  it('configSlice writes `authMode` into `serverMode` from /system/config', async () => {
    const slice = await readFile(
      path.join(SRC_ROOT, 'domain', 'store', 'slices', 'configSlice.ts'),
      'utf8',
    );
    expect(slice).toMatch(/system\/config/);
    expect(slice).toMatch(/authMode/);
    expect(slice).toMatch(/data:\s*config\.authMode/);
  });

  it('@ant/shared exports SystemConfigResponse with authMode: ServerMode', async () => {
    const shape = await readFile(SHARED_INDEX, 'utf8');
    expect(shape).toMatch(/export\s+type\s+ServerMode\s*=\s*'local'\s*\|\s*'cloud'/);
    expect(shape).toMatch(/interface\s+SystemConfigResponse/);
    expect(shape).toMatch(/authMode:\s*ServerMode/);
  });
});
