/**
 * `GET /status` and `GET /preview-config` must report IDENTICAL project facts for
 * the same workspace, idle or running.
 *
 * They used to disagree by construction: `/status` answered from an idle-only
 * filesystem probe (`quickDetect` — language only, no framework, and
 * `frontend-only` for every non-workspace Node repo), while `/preview-config`
 * answered from Redis alone with no filesystem fallback at all. That produced
 * both reported symptoms — a framework that never appeared, and a structureType
 * that flipped across a start/stop cycle.
 *
 * Both endpoints now compose the same two steps, which is what this exercises.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProjectProfileDetector } from '../../src/periphery/adapters/http/services/PreviewService/detectors/ProjectProfileDetector';
import { resolveProjectFacts } from '../../src/periphery/adapters/http/services/PreviewService/utils/projectFacts';
import type { PreviewConfigRecord } from '../../src/core/ports/preview';

let root: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-parity-'));
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'api', scripts: { 'start:dev': 'nest start --watch' }, dependencies: { '@nestjs/core': '^11.0.0' } }),
  );
  fs.writeFileSync(path.join(root, 'tsconfig.json'), '{}');
});
afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** Mirrors what both route handlers do, minus Express. */
async function endpointFacts(opts: {
  isBusy: boolean;
  runtime?: { structureType?: string; projectProfile?: any };
  cached?: PreviewConfigRecord | null;
}) {
  const detected = await new ProjectProfileDetector().detectFacts(
    root,
    opts.cached?.projectProfile ?? undefined,
  );
  return resolveProjectFacts({
    detected,
    runtime: opts.runtime as any,
    cached: opts.cached,
    isBusy: opts.isBusy,
  });
}

describe('endpoint parity', () => {
  it('idle: both endpoints see the same manifest facts (nestjs, backend-only)', async () => {
    // /status has no cached config yet; /preview-config reads one. Same answer.
    const status = await endpointFacts({ isBusy: false, cached: null });
    const config = await endpointFacts({ isBusy: false, cached: { connections: [] } });

    expect(status.structureType).toBe('backend-only');
    expect(status.projectProfile).toMatchObject({ language: 'typescript', framework: 'nestjs', source: 'manifest' });
    expect(config.structureType).toBe(status.structureType);
    expect(config.projectProfile).toEqual(status.projectProfile);
  });

  it('running: identical facts, and canStart is suppressed on both', async () => {
    const runtime = { structureType: 'backend-only', projectProfile: { language: 'typescript', framework: 'nestjs', structureType: 'backend-only', source: 'manifest' } };
    const status = await endpointFacts({ isBusy: true, runtime });
    const config = await endpointFacts({ isBusy: true, runtime, cached: { connections: [] } });

    expect(status.projectProfile).toEqual(config.projectProfile);
    expect(status.structureType).toBe(config.structureType);
    expect(status.canStart).toBe(false);
    expect(config.canStart).toBe(false);
  });

  it('a stale hint in the cache cannot flip the answer across a start/stop cycle', async () => {
    const staleHint: PreviewConfigRecord = {
      structureType: 'fullstack',
      projectProfile: { language: 'typescript', framework: 'nextjs', structureType: 'fullstack', source: 'techtier-hint' },
    };
    const idle = await endpointFacts({ isBusy: false, cached: staleHint });
    const running = await endpointFacts({
      isBusy: true,
      cached: staleHint,
      runtime: { structureType: 'backend-only', projectProfile: { language: 'typescript', framework: 'nestjs', structureType: 'backend-only', source: 'manifest' } },
    });

    expect(idle.structureType).toBe('backend-only');
    expect(running.structureType).toBe('backend-only');
    expect(idle.projectProfile?.framework).toBe('nestjs');
    expect(running.projectProfile?.framework).toBe('nestjs');
  });
});
