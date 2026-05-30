/**
 * FilePromptAdapter dot-path regression locker.
 *
 * Locks two invariants of `shouldValidate`:
 *
 *   1. `{{#if X.Y}}{{var}}{{/if}}` where `X.Y` resolves falsy on `vars`
 *      MUST NOT report `var` as missing. The legacy regex captured only
 *      the head segment (`X`) so any truthy parent object force-validated
 *      inner-each fields — surfacing as a spurious "missing variables"
 *      warning even when the outer collection was undefined.
 *
 *   2. `{{#if X.Y}}{{var}}{{/if}}` where `X.Y` resolves truthy but the
 *      inner `var` is not in `vars` MUST still report `var` as missing —
 *      the regex fix does not silently mask real authoring gaps.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FilePromptAdapter } from '../../src/periphery/adapters/prompt/FilePromptAdapter';

describe('FilePromptAdapter — dot-path conditional', () => {
  let tmpDir: string;
  let adapter: FilePromptAdapter;
  let warnSpy: any;
  let originalWarn: any;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ant-dot-path-'));
    adapter = new FilePromptAdapter(tmpDir);
    warnSpy = [] as string[];
    originalWarn = console.warn;
    console.warn = (...args: any[]) => warnSpy.push(args.join(' '));
  });

  afterEach(async () => {
    console.warn = originalWarn;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('falsy dot-path guard suppresses inner-var missing warning', async () => {
    const tplName = 'guard-falsy';
    const file = path.join(tmpDir, `${tplName}.md`);
    fsSync.writeFileSync(
      file,
      `{{#if resolvedAction.documents}}{{#each resolvedAction.documents}}{{label}} {{path}} {{content}}{{/each}}{{/if}}`,
    );

    adapter.clearViolations();
    await adapter.render(tplName, { resolvedAction: { /* no documents */ } });

    const spurious = warnSpy.filter((m: string) => m.includes('missing variables'));
    expect(spurious).toEqual([]);
    expect(adapter.lastViolations).toEqual([]);
  });

  it('truthy dot-path guard still validates inner-var presence', async () => {
    const tplName = 'guard-truthy';
    const file = path.join(tmpDir, `${tplName}.md`);
    // Top-level `headline` is referenced inside a truthy guard.
    // The guard's discriminator (`payload.ready`) is truthy → adapter
    // validates `headline` membership in top-level vars → reports missing.
    fsSync.writeFileSync(
      file,
      `{{#if payload.ready}}{{headline}}{{/if}}`,
    );

    adapter.clearViolations();
    await adapter.render(tplName, { payload: { ready: true } /* headline missing */ });

    const missingHeadline = warnSpy.find((m: string) =>
      m.includes('missing variables') && m.includes('headline'),
    );
    expect(missingHeadline).toBeTruthy();
    expect(adapter.lastViolations[0]?.missingVars).toContain('headline');
  });

  it('top-level scalar guard continues to work (single-segment dot path)', async () => {
    const tplName = 'guard-single';
    const file = path.join(tmpDir, `${tplName}.md`);
    fsSync.writeFileSync(file, `{{#if showHeader}}{{headline}}{{/if}}`);

    adapter.clearViolations();
    await adapter.render(tplName, { showHeader: false /* headline absent — OK */ });

    const spurious = warnSpy.filter((m: string) => m.includes('missing variables'));
    expect(spurious).toEqual([]);
  });
});
