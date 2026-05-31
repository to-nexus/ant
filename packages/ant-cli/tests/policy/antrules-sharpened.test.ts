/**
 * Locks the Condition 2 sharpening + "Shared call shapes / signatures"
 * out-of-scope item added to `jobs/code/base/injections/antrules`.
 *
 * The sharpening reframes Condition 2 ("Not auto-derivable") to explicitly
 * cover any file the implementation phase can `read_file` — not just the
 * existing manifests/configs. This closes the loophole that allowed
 * shared call shapes to be recorded in ANTRULES even though the defining
 * source file is the SSOT.
 *
 * Both branches of the partial ({{#if antrulesContent}} body + {{else}}
 * create-if-needed body) must carry the sharpening so setup and live-
 * update flows agree.
 */

import { describe, it, expect } from 'vitest';
import { FilePromptAdapter } from '../../src/periphery/adapters/prompt/FilePromptAdapter';

const TEMPLATE = 'jobs/code/base/injections/antrules';

describe('antrules — Condition 2 sharpening + shared-signature out-of-scope', () => {
  const adapter = new FilePromptAdapter();

  it('sharpens Condition 2 in the content-present branch to name read_file-reachable files', async () => {
    const out = await adapter.render(TEMPLATE, { antrulesContent: '## X\n- y\n' });
    expect(out).toMatch(/any existing file the implementation phase can `read_file`/);
    expect(out).toMatch(/auto-derivable and does NOT belong in ANTRULES/);
  });

  it('sharpens Condition 2 in the create-if-needed branch too', async () => {
    const out = await adapter.render(TEMPLATE, { antrulesContent: undefined });
    expect(out).toMatch(/any existing file the implementation phase can `read_file`/);
    expect(out).toMatch(/Shared call shapes \/ signatures \/ type shapes \(defined in source files\) are auto-derivable/);
  });

  it('adds "shared call shapes / signatures / type shapes" to the Do NOT record list (content branch)', async () => {
    const out = await adapter.render(TEMPLATE, { antrulesContent: '## X\n- y\n' });
    expect(out).toMatch(/shared call shapes \/ signatures \/ type shapes/i);
    expect(out).toMatch(/execute verifies against the defining file at write-time/i);
    expect(out).toMatch(/duplicates the SSOT and seeds drift/);
  });
});
