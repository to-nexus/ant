/**
 * M-NEW-029 — session state is an internal namespace, not a user file surface.
 *
 * Two contracts:
 *  (a) the bounded session reader refuses an oversized session on its own
 *      descriptor (SESSION_TOO_LARGE) instead of materialising + parsing it, and
 *  (b) the generic file API refuses any mutation aimed at `sessions/**` so the
 *      state cannot be grown into the readers in the first place.
 */

import { describe, it, expect, afterAll } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import {
  readSessionTextBounded,
  readSessionTextBoundedAsync,
  SessionTooLargeError,
  SESSION_MAX_BYTES,
} from '../../src/core/utils/sessionPaths';

describe('bounded session readers (M-NEW-029)', () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'sess-'));
  const ok = path.join(dir, 'code.json');
  const huge = path.join(dir, 'huge.json');
  fs.writeFileSync(ok, JSON.stringify({ state: { jobId: 'j1' } }), 'utf-8');
  fs.writeFileSync(huge, 'x'.repeat(SESSION_MAX_BYTES + 1), 'utf-8');

  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('sync: returns content within budget', () => {
    expect(readSessionTextBounded(ok)).toContain('j1');
  });
  it('sync: returns null for a missing file', () => {
    expect(readSessionTextBounded(path.join(dir, 'nope.json'))).toBeNull();
  });
  it('sync: throws SessionTooLargeError past the budget (no full read)', () => {
    expect(() => readSessionTextBounded(huge)).toThrow(SessionTooLargeError);
  });
  it('async: throws SessionTooLargeError past the budget', async () => {
    await expect(readSessionTextBoundedAsync(huge)).rejects.toBeInstanceOf(SessionTooLargeError);
  });
  it('async: returns null for a missing file', async () => {
    expect(await readSessionTextBoundedAsync(path.join(dir, 'nope.json'))).toBeNull();
  });
});
