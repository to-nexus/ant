/**
 * Service Virtualization SSOT regression guard.
 *
 * Phase 2 of the `mock_real_symmetry_ssot` plan introduced three orthogonal
 * partials under the umbrella concept "Service Virtualization":
 *
 *   - `service-virtualization-contract` — port shape + toggle grammar
 *   - `service-virtualization-data`     — fake body realism (non-image)
 *   - `service-virtualization-imagery`  — image subtype dispatch
 *
 * This guard locks (across 5 sub-suites):
 *   1. Body discipline — language/platform neutrality + game-vocabulary
 *      absence + 3-partial cross-talk absence
 *   2. Wire sites — partial-include presence at plan + execute rules.md
 *   3. Gate truth tables — three predicates, one test each axis
 *   4. End-to-end Handlebars render — boolean drives include
 *   5. Removed legacy artifacts — old mock-* files MUST NOT exist
 *
 * The umbrella naming policy (abstract = "Service Virtualization"; leaf =
 * "mock") is enforced by the sibling `service-virtualization-vocabulary`
 * suite under `tests/policy/`.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../..');
const TEMPLATES_ROOT = path.join(REPO_ROOT, 'src/core/prompt/templates');
const INJECTIONS_DIR = path.join(TEMPLATES_ROOT, 'jobs/code/base/injections');
const PARTIAL_CONTRACT = path.join(INJECTIONS_DIR, 'service-virtualization-contract.md');
const PARTIAL_DATA = path.join(INJECTIONS_DIR, 'service-virtualization-data.md');
const PARTIAL_IMAGERY = path.join(INJECTIONS_DIR, 'service-virtualization-imagery.md');
const PLAN_RULES = path.join(TEMPLATES_ROOT, 'jobs/code/nodes/plan/rules.md');
const EXECUTE_RULES = path.join(TEMPLATES_ROOT, 'jobs/code/nodes/execute/variants/default/rules.md');
const BUILD_MESSAGES = path.join(REPO_ROOT, 'src/agents/architect/graph/code/nodes/execute/buildMessages.ts');
const PLAN_PROMPT = path.join(REPO_ROOT, 'src/agents/architect/graph/code/nodes/plan/llm/prompt.ts');

const INCLUDE_CONTRACT = '{{> jobs/code/base/injections/service-virtualization-contract}}';
const INCLUDE_DATA = '{{> jobs/code/base/injections/service-virtualization-data}}';
const INCLUDE_IMAGERY = '{{> jobs/code/base/injections/service-virtualization-imagery}}';

function read(p: string): string {
  return fs.readFileSync(p, 'utf-8');
}

// =============================================================================
// 1. Body discipline — FPOP / SBS / cross-talk MECE
// =============================================================================

describe('service-virtualization partials — body discipline', () => {
  const partials: Array<{ name: string; path: string }> = [
    { name: 'contract', path: PARTIAL_CONTRACT },
    { name: 'data', path: PARTIAL_DATA },
    { name: 'imagery', path: PARTIAL_IMAGERY },
  ];

  for (const { name, path: partialPath } of partials) {
    it(`${name}: file exists`, () => {
      expect(fs.existsSync(partialPath)).toBe(true);
    });

    it(`${name}: body is English-only (no Korean / non-Latin code points)`, () => {
      const src = read(partialPath);
      const hangul = src.match(/[\uAC00-\uD7A3]/g);
      expect(hangul, `Korean characters detected in ${partialPath}`).toBeNull();
    });

    it(`${name}: body does NOT cite platform-specific names (FPOP §3)`, () => {
      const src = read(partialPath);
      const banned = ['React', 'Tailwind', 'Next\\.js', 'Vue', 'Svelte', 'Angular'];
      for (const word of banned) {
        const re = new RegExp(`\\b${word}\\b`);
        expect(re.test(src), `platform-specific term '${word}' present in ${partialPath}`).toBe(false);
      }
    });

    it(`${name}: body does NOT leak game-domain vocabulary (Domain-Surface Boundary I7)`, () => {
      const src = read(partialPath);
      const banned = ['sprite', 'OscillatorNode', 'particle', 'projectile'];
      for (const word of banned) {
        const re = new RegExp(`\\b${word}\\b`, 'i');
        expect(re.test(src), `game-domain term '${word}' present in ${partialPath}`).toBe(false);
      }
    });
  }

  it('contract: MUST NOT mention data-realism / imagery vocabulary (MECE §3)', () => {
    const src = read(PARTIAL_CONTRACT);
    const banned = ['Lorem ipsum', 'placeholder image', 'inline SVG', 'data realism'];
    for (const phrase of banned) {
      expect(
        src.toLowerCase().includes(phrase.toLowerCase()),
        `contract MUST NOT cite '${phrase}'`,
      ).toBe(false);
    }
  });

  it('data: MUST NOT mention port-shape vocabulary (MECE §3)', () => {
    const src = read(PARTIAL_DATA);
    const banned = ['interface contract', 'port shape', 'adapter pair', 'switching contract'];
    for (const phrase of banned) {
      expect(
        src.toLowerCase().includes(phrase.toLowerCase()),
        `data MUST NOT cite '${phrase}'`,
      ).toBe(false);
    }
  });

  it('imagery: MUST NOT mention non-image data fields (MECE §3)', () => {
    const src = read(PARTIAL_IMAGERY);
    const banned = ['timestamp', 'cross-entity', 'fake user name', 'fake order'];
    for (const phrase of banned) {
      expect(
        src.toLowerCase().includes(phrase.toLowerCase()),
        `imagery MUST NOT cite '${phrase}'`,
      ).toBe(false);
    }
  });

  it('contract: cites the per-connection toggle env var grammar (USE_MOCK_<NAME>)', () => {
    const src = read(PARTIAL_CONTRACT);
    expect(src).toMatch(/USE_MOCK_/);
  });

  it('imagery: declares the three pathway categories (categorized — SBS-required)', () => {
    const src = read(PARTIAL_IMAGERY);
    expect(src).toMatch(/Inline SVG/);
    expect(src).toMatch(/Existing library|library/);
    expect(src).toMatch(/External placeholder service|placeholder service/);
  });
});

// =============================================================================
// 2. Wire sites — plan + execute include all three partials with gates
// =============================================================================

describe('service-virtualization — wire sites', () => {
  for (const [label, rulesPath] of [
    ['plan/rules.md', PLAN_RULES],
    ['execute/variants/default/rules.md', EXECUTE_RULES],
  ] as const) {
    it(`${label} includes contract partial`, () => {
      expect(read(rulesPath).includes(INCLUDE_CONTRACT)).toBe(true);
    });
    it(`${label} includes data partial`, () => {
      expect(read(rulesPath).includes(INCLUDE_DATA)).toBe(true);
    });
    it(`${label} includes imagery partial`, () => {
      expect(read(rulesPath).includes(INCLUDE_IMAGERY)).toBe(true);
    });

    it(`${label}: contract include is gated by serviceVirtualizationContractActive`, () => {
      const src = read(rulesPath);
      const idx = src.indexOf(INCLUDE_CONTRACT);
      expect(idx).toBeGreaterThan(-1);
      const window = src.slice(Math.max(0, idx - 400), idx);
      expect(window).toMatch(/serviceVirtualizationContractActive/);
      // I1 — no domain comparison in templates
      expect(window).not.toMatch(/eq\s+resolvedAction\.domain\s+"service"/);
    });

    it(`${label}: data include is gated by serviceVirtualizationDataActive`, () => {
      const src = read(rulesPath);
      const idx = src.indexOf(INCLUDE_DATA);
      expect(idx).toBeGreaterThan(-1);
      const window = src.slice(Math.max(0, idx - 400), idx);
      expect(window).toMatch(/serviceVirtualizationDataActive/);
    });

    it(`${label}: imagery include is gated by serviceVirtualizationImageryActive`, () => {
      const src = read(rulesPath);
      const idx = src.indexOf(INCLUDE_IMAGERY);
      expect(idx).toBeGreaterThan(-1);
      const window = src.slice(Math.max(0, idx - 400), idx);
      expect(window).toMatch(/serviceVirtualizationImageryActive/);
    });
  }

  it('buildMessages.ts injects all three Active flags', () => {
    const src = read(BUILD_MESSAGES);
    expect(src).toMatch(/isServiceVirtualizationContractActive\s*\(/);
    expect(src).toMatch(/isServiceVirtualizationDataActive\s*\(/);
    expect(src).toMatch(/isServiceVirtualizationImageryActive\s*\(/);
    expect(src).toMatch(/serviceVirtualizationContractActive:/);
    expect(src).toMatch(/serviceVirtualizationDataActive:/);
    expect(src).toMatch(/serviceVirtualizationImageryActive:/);
  });

  it('plan/llm/prompt.ts injects all three Active flags', () => {
    const src = read(PLAN_PROMPT);
    expect(src).toMatch(/isServiceVirtualizationContractActive\s*\(/);
    expect(src).toMatch(/isServiceVirtualizationDataActive\s*\(/);
    expect(src).toMatch(/isServiceVirtualizationImageryActive\s*\(/);
    expect(src).toMatch(/serviceVirtualizationContractActive:/);
    expect(src).toMatch(/serviceVirtualizationDataActive:/);
    expect(src).toMatch(/serviceVirtualizationImageryActive:/);
  });
});

// =============================================================================
// 3. Gate truth tables — three predicates
// =============================================================================

import {
  isServiceVirtualizationContractActive,
  isServiceVirtualizationDataActive,
  isServiceVirtualizationImageryActive,
} from '../../src/core/prompt/builder/serviceVirtualization';

describe('isServiceVirtualizationContractActive — gate truth table', () => {
  it('hasBusinessConnection=true → active', () => {
    expect(isServiceVirtualizationContractActive({ hasBusinessConnection: true })).toBe(true);
  });
  it('hasBusinessConnection=false → inactive', () => {
    expect(isServiceVirtualizationContractActive({ hasBusinessConnection: false })).toBe(false);
  });
});

describe('isServiceVirtualizationDataActive — gate truth table', () => {
  const cases: Array<{ name: string; has: boolean; t: string | undefined; expected: boolean }> = [
    { name: 'business + feature', has: true, t: 'feature', expected: true },
    { name: 'business + ui', has: true, t: 'ui', expected: true },
    { name: 'business + design-system', has: true, t: 'design-system', expected: true },
    { name: 'business + setup', has: true, t: 'setup', expected: false },
    { name: 'business + verification', has: true, t: 'verification', expected: false },
    { name: 'business + error', has: true, t: 'error', expected: false },
    { name: 'business + test-code', has: true, t: 'test-code', expected: false },
    { name: 'business + doc', has: true, t: 'doc', expected: false },
    { name: 'business + undefined', has: true, t: undefined, expected: false },
    { name: 'no business + feature', has: false, t: 'feature', expected: false },
  ];
  for (const c of cases) {
    it(c.name, () => {
      expect(
        isServiceVirtualizationDataActive({ hasBusinessConnection: c.has, taskType: c.t }),
      ).toBe(c.expected);
    });
  }
});

describe('isServiceVirtualizationImageryActive — gate truth table', () => {
  const cases: Array<{
    name: string;
    domain: string | undefined;
    hasFrontend: boolean;
    taskType: string | undefined;
    expected: boolean;
  }> = [
    { name: 'service + FE + feature', domain: 'service', hasFrontend: true, taskType: 'feature', expected: true },
    { name: 'service + FE + ui', domain: 'service', hasFrontend: true, taskType: 'ui', expected: true },
    { name: 'service + FE + design-system', domain: 'service', hasFrontend: true, taskType: 'design-system', expected: true },
    { name: 'service + FE + setup', domain: 'service', hasFrontend: true, taskType: 'setup', expected: true },
    { name: 'service + FE + error', domain: 'service', hasFrontend: true, taskType: 'error', expected: true },
    { name: 'service + FE + verification', domain: 'service', hasFrontend: true, taskType: 'verification', expected: true },
    { name: 'service + FE + doc', domain: 'service', hasFrontend: true, taskType: 'doc', expected: false },
    { name: 'service + FE + test-code', domain: 'service', hasFrontend: true, taskType: 'test-code', expected: false },
    { name: 'service + FE + undefined', domain: 'service', hasFrontend: true, taskType: undefined, expected: false },
    { name: 'service + BE + feature', domain: 'service', hasFrontend: false, taskType: 'feature', expected: false },
    { name: 'game + FE + feature', domain: 'game', hasFrontend: true, taskType: 'feature', expected: false },
    { name: 'undefined domain + FE + feature', domain: undefined, hasFrontend: true, taskType: 'feature', expected: false },
  ];
  for (const c of cases) {
    it(c.name, () => {
      expect(
        isServiceVirtualizationImageryActive({
          hasFrontend: c.hasFrontend,
          domain: c.domain,
          taskType: c.taskType,
        }),
      ).toBe(c.expected);
    });
  }
});

// =============================================================================
// 4. End-to-end Handlebars render — booleans drive include in BOTH nodes
// =============================================================================

import { FilePromptAdapter, initPartials } from '../../src/periphery/adapters/prompt/FilePromptAdapter';

describe('service-virtualization — Handlebars boolean gate render', () => {
  let adapter: FilePromptAdapter;

  // Sentinels appear ONLY in the respective partial body, so we can assert
  // partial inclusion after rendering the wrapping rules.md file.
  const SENTINEL_CONTRACT = 'Service Virtualization Contract';
  const SENTINEL_DATA = 'Fake Data Realism';
  const SENTINEL_IMAGERY = 'Service Virtualization — Imagery';

  beforeAll(async () => {
    await initPartials(TEMPLATES_ROOT);
    adapter = new FilePromptAdapter(TEMPLATES_ROOT);
  });

  for (const [label, templatePath] of [
    ['plan/rules', 'jobs/code/nodes/plan/rules'],
    ['execute/rules', 'jobs/code/nodes/execute/variants/default/rules'],
  ] as const) {
    it(`${label} — contract gate true → contract body present`, async () => {
      const out = await adapter.render(templatePath, {
        serviceVirtualizationContractActive: true,
      });
      expect(out).toContain(SENTINEL_CONTRACT);
    });

    it(`${label} — contract gate false → contract body absent`, async () => {
      const out = await adapter.render(templatePath, {
        serviceVirtualizationContractActive: false,
      });
      expect(out).not.toContain(SENTINEL_CONTRACT);
    });

    it(`${label} — data gate true → data body present`, async () => {
      const out = await adapter.render(templatePath, {
        serviceVirtualizationDataActive: true,
      });
      expect(out).toContain(SENTINEL_DATA);
    });

    it(`${label} — data gate false → data body absent`, async () => {
      const out = await adapter.render(templatePath, {
        serviceVirtualizationDataActive: false,
      });
      expect(out).not.toContain(SENTINEL_DATA);
    });

    it(`${label} — imagery gate true → imagery body present`, async () => {
      const out = await adapter.render(templatePath, {
        serviceVirtualizationImageryActive: true,
      });
      expect(out).toContain(SENTINEL_IMAGERY);
    });

    it(`${label} — imagery gate false → imagery body absent`, async () => {
      const out = await adapter.render(templatePath, {
        serviceVirtualizationImageryActive: false,
      });
      expect(out).not.toContain(SENTINEL_IMAGERY);
    });

    it(`${label} — all gates undefined → all bodies absent (default falsy)`, async () => {
      const out = await adapter.render(templatePath, {});
      expect(out).not.toContain(SENTINEL_CONTRACT);
      expect(out).not.toContain(SENTINEL_DATA);
      expect(out).not.toContain(SENTINEL_IMAGERY);
    });
  }
});

// =============================================================================
// 5. Removed legacy artifacts — phase-2 deletions are permanent
// =============================================================================

describe('service-virtualization — legacy artifacts removed', () => {
  it('legacy mock-adapter-contract.md MUST NOT exist', () => {
    const legacy = path.join(INJECTIONS_DIR, 'mock-adapter-contract.md');
    expect(fs.existsSync(legacy)).toBe(false);
  });

  it('legacy mock-content-imagery.md MUST NOT exist', () => {
    const legacy = path.join(INJECTIONS_DIR, 'mock-content-imagery.md');
    expect(fs.existsSync(legacy)).toBe(false);
  });

  it('legacy mockContentImageryGate.ts MUST NOT exist', () => {
    const legacy = path.join(REPO_ROOT, 'src/core/prompt/builder/mockContentImageryGate.ts');
    expect(fs.existsSync(legacy)).toBe(false);
  });

  it('legacy import path MUST NOT appear in code', () => {
    const dirs = [
      path.join(REPO_ROOT, 'src/agents/architect/graph/code/nodes/execute'),
      path.join(REPO_ROOT, 'src/agents/architect/graph/code/nodes/plan'),
    ];
    for (const dir of dirs) {
      walk(dir, (file) => {
        const src = fs.readFileSync(file, 'utf-8');
        expect(
          src.includes('mockContentImageryGate'),
          `${file} still imports legacy mockContentImageryGate`,
        ).toBe(false);
      });
    }
  });
});

function walk(dir: string, visit: (file: string) => void): void {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs, visit);
    else if (e.isFile() && (abs.endsWith('.ts') || abs.endsWith('.tsx'))) visit(abs);
  }
}
