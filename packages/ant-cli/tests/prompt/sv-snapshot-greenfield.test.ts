/**
 * Service Virtualization snapshot — greenfield activation regression guard.
 *
 * Root cause this locks: `virtualizationSnapshot.hasBusinessConnection` is
 * derived at the resolve node from the on-disk `codebase/.env.example`. For
 * a GREENFIELD job the codebase is empty at resolve (the `.env.example` is
 * written later by `setup`), so the flag froze `false` and silently
 * suppressed all SV partials + the parity check.
 *
 * Fix: SV implementation guidance is a GENERATION decision (orthogonal to
 * the runtime mock/real toggle), so it defaults ON for greenfield —
 * `buildVirtualizationSnapshot` = detect(business @connection) OR greenfield.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  detectHasBusinessConnection,
  detectIsGreenfield,
  buildVirtualizationSnapshot,
} from '../../src/core/prompt/builder/serviceVirtualization';

let featurePath: string;
let codebaseRoot: string;

beforeEach(async () => {
  featurePath = await fs.mkdtemp(path.join(os.tmpdir(), 'ant-sv-snapshot-'));
  codebaseRoot = path.join(featurePath, 'codebase');
});

afterEach(async () => {
  await fs.rm(featurePath, { recursive: true, force: true });
});

async function write(rel: string, content: string): Promise<void> {
  const abs = path.join(codebaseRoot, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf8');
}

describe('buildVirtualizationSnapshot — greenfield default ON', () => {
  it('greenfield (empty codebase, no manifest) → hasBusinessConnection=true', async () => {
    await fs.mkdir(codebaseRoot, { recursive: true });
    expect(await detectIsGreenfield(featurePath)).toBe(true);
    expect(await detectHasBusinessConnection(featurePath)).toBe(false);
    expect((await buildVirtualizationSnapshot(featurePath)).hasBusinessConnection).toBe(true);
  });

  it('greenfield where codebase dir does not exist yet → true', async () => {
    // resolve may run before the codebase dir itself is created.
    expect(await detectIsGreenfield(featurePath)).toBe(true);
    expect((await buildVirtualizationSnapshot(featurePath)).hasBusinessConnection).toBe(true);
  });

  it('existing project (root package.json), NO business @connection → false (no false-positive)', async () => {
    await write('package.json', JSON.stringify({ name: 'existing' }));
    await write('.env.example', 'PORT=3000\n# just a local var\n');
    expect(await detectIsGreenfield(featurePath)).toBe(false);
    expect(await detectHasBusinessConnection(featurePath)).toBe(false);
    expect((await buildVirtualizationSnapshot(featurePath)).hasBusinessConnection).toBe(false);
  });

  it('existing project WITH business @connection → true (existing-project signal)', async () => {
    await write('package.json', JSON.stringify({ name: 'existing' }));
    await write('.env.example', '# @connection business backend-api self\nNEXT_PUBLIC_API_BASE_URL=\n');
    expect(await detectIsGreenfield(featurePath)).toBe(false);
    expect(await detectHasBusinessConnection(featurePath)).toBe(true);
    expect((await buildVirtualizationSnapshot(featurePath)).hasBusinessConnection).toBe(true);
  });

  it('monorepo member manifest (apps/app/package.json) → NOT greenfield', async () => {
    await write('pnpm-workspace.yaml', "packages:\n  - 'apps/*'\n");
    await write('apps/app/package.json', JSON.stringify({ name: '@x/app' }));
    expect(await detectIsGreenfield(featurePath)).toBe(false);
    // No @connection anywhere and not greenfield → SV stays off.
    expect((await buildVirtualizationSnapshot(featurePath)).hasBusinessConnection).toBe(false);
  });

  it('non-JS manifest (go.mod) also counts as existing → NOT greenfield', async () => {
    await write('go.mod', 'module example.com/x\n');
    expect(await detectIsGreenfield(featurePath)).toBe(false);
  });

  it('undefined featurePath → not greenfield, snapshot false (no workspace context)', async () => {
    expect(await detectIsGreenfield(undefined)).toBe(false);
    expect(await detectHasBusinessConnection(undefined)).toBe(false);
    expect((await buildVirtualizationSnapshot(undefined)).hasBusinessConnection).toBe(false);
  });
});
