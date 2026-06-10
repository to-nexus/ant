/**
 * Axis 4 — manually-constructed absolute URL basePath lock.
 *
 * RCA (classboard green-basing-helix): admin login built
 * `window.location.origin + '/auth/callback'`, bypassing Next's basePath (the
 * router auto-prefixes <Link>/push, manual origin+path strings do not) → the
 * OAuth callback escaped the preview proxy prefix. preview-env-contract §1 now
 * warns that hand-built absolute URLs (incl. OAuth redirect_uri) must include
 * the base-path prefix read from the framework's base-path variable.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'path';
import { FilePromptAdapter, initPartials } from '../../src/periphery/adapters/prompt/FilePromptAdapter';

const TEMPLATES_DIR = join(__dirname, '../../src/core/prompt/templates');
const PREVIEW = 'jobs/code/base/injections/preview-env-contract';

describe('Axis 4 — preview-env-contract manually-constructed absolute URLs', () => {
  let adapter: FilePromptAdapter;
  let out: string;

  beforeAll(async () => {
    await initPartials(TEMPLATES_DIR);
    adapter = new FilePromptAdapter(TEMPLATES_DIR);
    out = await adapter.render(PREVIEW, {});
  });

  it('adds the Manually-constructed absolute URLs subsection', () => {
    expect(out).toMatch(/### Manually-constructed absolute URLs/);
  });

  it('explains the framework auto-prefixes ONLY native primitives', () => {
    expect(out).toMatch(/auto-prefixes the base path ONLY/);
  });

  it('covers OAuth redirect / callback targets explicitly', () => {
    expect(out).toMatch(/redirect ?\/ ?callback target/i);
    expect(out).toMatch(/redirect_uri/);
  });

  // iterative-mango 2-4: classboard admin `<SectionHead href="/logs">` rendered a
  // raw <a href="/logs"> in a shared package, dropping the preview path prefix.
  // §1's enumeration was imperative-only; it must also name the declarative literal.
  it('covers declarative literal absolute paths (raw anchor href / asset src)', () => {
    expect(out).toMatch(/declarative link or asset reference/i);
    expect(out).toMatch(/anchor `href`/);
  });

  it('stays English-only (no Hangul)', () => {
    expect(out).not.toMatch(/[가-힣]/);
  });
});
