// Regression guard for the seam closure "path-prefix conformance" axis.
//
// Root cause (classboard / tame-holding-knave): a generated app's auth flow
// used `window.location.replace('/')` (and a raw `<a href="/...">`) — bare
// absolute paths emitted OUTSIDE the framework's navigation/asset primitive, so
// they miss the served base-path prefix and 404 under a preview path prefix.
// The seam closure model resolved/landed them (the route exists, lands in-app)
// but its base-path-form discipline was scoped to CROSS-APP references only, so
// intra-app non-primitive path references slipped through.
//
// The fix generalizes that discipline to EVERY path reference emitted outside
// the framework primitive, keyed on the through-vs-outside channel (not on
// in-app-vs-external). The basePath RULE itself stays owned by
// preview-env-contract (MECE) — the seam only enforces conformance as a closure
// axis.

import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'path';
import { FilePromptAdapter, initPartials } from '../../src/periphery/adapters/prompt/FilePromptAdapter';

const TEMPLATES_DIR = join(__dirname, '../../src/core/prompt/templates');
const PARTIAL = 'jobs/code/base/injections/seam/connectivity-closure';

describe('seam connectivity-closure — path-prefix conformance axis', () => {
  let adapter: FilePromptAdapter;
  let remediation: string;

  beforeAll(async () => {
    await initPartials(TEMPLATES_DIR);
    adapter = new FilePromptAdapter(TEMPLATES_DIR);
    // taskType=seam, no seamPlanning / seamClassifyingParent → the
    // "Remediation — resolve OR remove" block (where the axis lives) renders.
    remediation = await adapter.render(PARTIAL, { taskType: 'seam' });
  });

  it('renders the path-prefix conformance bullet in the remediation block', () => {
    expect(remediation).toMatch(/conform to the served prefix by their routing channel/);
  });

  it('keys correctness on the through-vs-outside channel, NOT in-app-vs-external', () => {
    // The exact model misconception: "in-app destinations are auto-prefixed".
    expect(remediation).toMatch(/not\s+by whether its destination is in-app or external/i);
    expect(remediation).toMatch(/in-app destination reached outside the primitive still needs the prefix/);
  });

  it('covers BOTH under-prefix (outside primitive) and over-prefix (through primitive)', () => {
    const lower = remediation.toLowerCase();
    expect(lower).toContain('outside');
    expect(lower).toMatch(/does not receive the\s+framework/);
    // over-prefix guard — a framework-primitive path must stay bare.
    expect(lower).toContain('must stay bare');
    expect(lower).toContain('double-applies');
  });

  it('names the non-primitive emission forms generically (nav + markup anchor + asset)', () => {
    const lower = remediation.toLowerCase();
    expect(lower).toContain('self-issued full-page navigation');
    expect(lower).toContain('markup anchor');
    expect(lower).toContain('asset reference');
    expect(lower).toContain('gated-entry landing target');
  });

  it('preserves the cross-app reference axis (no regression)', () => {
    expect(remediation).toContain('Cross-app / cross-package outbound references resolve');
    expect(remediation).toContain('never a raw literal absolute path');
  });

  it('MECE — defers the basePath RULE to the injected framework guidance, does not restate it', () => {
    expect(remediation).toContain('per the framework guidance injected for this run');
    // The seam partial must NOT re-declare the env-var-level rule owned by
    // preview-env-contract.
    expect(remediation).not.toContain('NEXT_PUBLIC_BASE_PATH');
    expect(remediation).not.toContain('VITE_BASE_PATH');
  });

  it('FPOP — stays platform-/framework-neutral (no React/Next/window.location literals)', () => {
    expect(remediation).not.toMatch(/window\.location|location\.(assign|href|replace)/);
    expect(remediation).not.toMatch(/\bReact\b|\bNext\.js\b|\bNextjs\b/);
  });
});
