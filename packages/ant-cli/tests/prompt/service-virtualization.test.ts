/**
 * Service Virtualization SSOT regression guard.
 *
 * Four orthogonal partials under the umbrella concept "Service Virtualization":
 *
 *   - `service-virtualization-contract` — port shape + toggle grammar
 *   - `service-virtualization-data`     — fake body realism (non-image, ONE response body)
 *   - `service-virtualization-imagery`  — image subtype dispatch
 *   - `service-virtualization-session`  — cross-body demo coherence over time
 *
 * This guard locks (across 5 sub-suites):
 *   1. Body discipline — language/platform neutrality + game-vocabulary
 *      absence + 4-partial cross-talk absence (bidirectional MECE)
 *   2. Wire sites — partial-include presence at plan + execute rules.md
 *   3. Gate truth tables — four predicates, one test each axis
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
const PARTIAL_SESSION = path.join(INJECTIONS_DIR, 'service-virtualization-session.md');
const PLAN_RULES = path.join(TEMPLATES_ROOT, 'jobs/code/nodes/plan/rules.md');
const EXECUTE_RULES = path.join(TEMPLATES_ROOT, 'jobs/code/nodes/execute/variants/default/rules.md');
const BUILD_MESSAGES = path.join(REPO_ROOT, 'src/agents/architect/graph/code/nodes/execute/buildMessages.ts');
const PLAN_PROMPT = path.join(REPO_ROOT, 'src/agents/architect/graph/code/nodes/plan/llm/prompt.ts');

const INCLUDE_CONTRACT = '{{> jobs/code/base/injections/service-virtualization-contract}}';
const INCLUDE_DATA = '{{> jobs/code/base/injections/service-virtualization-data}}';
const INCLUDE_IMAGERY = '{{> jobs/code/base/injections/service-virtualization-imagery}}';
const INCLUDE_SESSION = '{{> jobs/code/base/injections/service-virtualization-session}}';

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
    { name: 'session', path: PARTIAL_SESSION },
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

    it(`${name}: body does NOT cite platform-specific storage / auth APIs (FPOP §3)`, () => {
      const src = read(partialPath);
      const banned = [
        'sessionStorage',
        'localStorage',
        'IndexedDB',
        'AsyncStorage',
        'JWT',
        'OAuth2',
        'autocomplete',
      ];
      for (const word of banned) {
        const re = new RegExp(`\\b${word}\\b`);
        expect(re.test(src), `platform-specific API/UX term '${word}' present in ${partialPath}`).toBe(false);
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

  it('contract: MUST NOT mention sibling-axis vocabulary (MECE §3)', () => {
    const src = read(PARTIAL_CONTRACT);
    const banned = [
      // data
      'Lorem ipsum',
      'data realism',
      // imagery
      'placeholder image',
      'inline SVG',
      // session
      'seeded identity',
      'authorization graph',
      'cross-body',
      'multi-endpoint cardinality',
      'surface discoverability',
      'mutation persistence',
    ];
    for (const phrase of banned) {
      expect(
        src.toLowerCase().includes(phrase.toLowerCase()),
        `contract MUST NOT cite '${phrase}'`,
      ).toBe(false);
    }
  });

  it('data: MUST NOT mention sibling-axis vocabulary (MECE §3)', () => {
    const src = read(PARTIAL_DATA);
    const banned = [
      // contract
      'interface contract',
      'port shape',
      'adapter pair',
      'switching contract',
      // session
      'seeded identity',
      'authorization graph',
      'cross-body',
      'inhabitant',
      'login surface',
      'mutation persistence',
      'surface discoverability',
    ];
    for (const phrase of banned) {
      expect(
        src.toLowerCase().includes(phrase.toLowerCase()),
        `data MUST NOT cite '${phrase}'`,
      ).toBe(false);
    }
  });

  it('imagery: MUST NOT mention sibling-axis vocabulary (MECE §3)', () => {
    const src = read(PARTIAL_IMAGERY);
    const banned = [
      // data
      'timestamp',
      'cross-entity',
      'fake user name',
      'fake order',
      // session
      'seeded identity',
      'authorization graph',
      'inhabitant',
      'mutation persistence',
    ];
    for (const phrase of banned) {
      expect(
        src.toLowerCase().includes(phrase.toLowerCase()),
        `imagery MUST NOT cite '${phrase}'`,
      ).toBe(false);
    }
  });

  it('session: MUST NOT mention sibling-axis deep content (MECE §3)', () => {
    // The session partial's defer table necessarily cites sibling scopes
    // (e.g. "Port shape + toggle grammar" for contract, "Image fields" for
    // imagery). Ban list focuses on DEEP content terms that never appear
    // in a one-line defer summary.
    const src = read(PARTIAL_SESSION);
    const banned = [
      // contract — deep content
      'interface contract',
      'adapter pair',
      'switching contract',
      'USE_MOCK_',
      // data — deep content
      'Lorem ipsum',
      'data realism',
      'temporal plausibility',
      'within-body FK',
      // imagery — deep content
      'inline SVG',
      'placeholder service',
    ];
    for (const phrase of banned) {
      expect(
        src.toLowerCase().includes(phrase.toLowerCase()),
        `session MUST NOT cite '${phrase}'`,
      ).toBe(false);
    }
  });

  it('session: requires an observable identity-selection step + per-identity scoping (SBS)', () => {
    const src = read(PARTIAL_SESSION);
    expect(src).toMatch(/selection affordance/i); // chooser, not silent bind
    expect(src).toMatch(/switching identity|re-select/i); // role re-selectable in one run
    expect(src).toMatch(/scoped records|scopes records/i); // per-identity data visibility
  });

  it('session: auth leg must derive the return URL from the handed redirectUri / runtime origin, not a hardcoded host (Defect 1a)', () => {
    const src = read(PARTIAL_SESSION);
    // derive from what the app handed / its runtime origin
    expect(src).toMatch(/you were actually handed|runtime origin|own origin at request time/i);
    // explicit prohibition on hardcoding a fixed host
    expect(src).toMatch(/hardcode a fixed host|baked-in origin/i);
  });

  it('session: disambiguates signup role-selection from login identity-selection (Defect 4)', () => {
    const src = read(PARTIAL_SESSION);
    expect(src).toMatch(/sign-up/i); // the first-time role step
    expect(src).toMatch(/returning[ -]user/i); // returning path must also reach the choice
    expect(src).toMatch(/identity choice|seeded-identity choice/i);
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
    it(`${label} includes session partial`, () => {
      expect(read(rulesPath).includes(INCLUDE_SESSION)).toBe(true);
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

    it(`${label}: session include is gated by serviceVirtualizationSessionActive`, () => {
      const src = read(rulesPath);
      const idx = src.indexOf(INCLUDE_SESSION);
      expect(idx).toBeGreaterThan(-1);
      const window = src.slice(Math.max(0, idx - 400), idx);
      expect(window).toMatch(/serviceVirtualizationSessionActive/);
    });
  }

  it('buildMessages.ts injects all four Active flags', () => {
    const src = read(BUILD_MESSAGES);
    expect(src).toMatch(/isServiceVirtualizationContractActive\s*\(/);
    expect(src).toMatch(/isServiceVirtualizationDataActive\s*\(/);
    expect(src).toMatch(/isServiceVirtualizationImageryActive\s*\(/);
    expect(src).toMatch(/isServiceVirtualizationSessionActive\s*\(/);
    expect(src).toMatch(/serviceVirtualizationContractActive:/);
    expect(src).toMatch(/serviceVirtualizationDataActive:/);
    expect(src).toMatch(/serviceVirtualizationImageryActive:/);
    expect(src).toMatch(/serviceVirtualizationSessionActive:/);
  });

  it('plan/llm/prompt.ts injects all four Active flags', () => {
    const src = read(PLAN_PROMPT);
    expect(src).toMatch(/isServiceVirtualizationContractActive\s*\(/);
    expect(src).toMatch(/isServiceVirtualizationDataActive\s*\(/);
    expect(src).toMatch(/isServiceVirtualizationImageryActive\s*\(/);
    expect(src).toMatch(/isServiceVirtualizationSessionActive\s*\(/);
    expect(src).toMatch(/serviceVirtualizationContractActive:/);
    expect(src).toMatch(/serviceVirtualizationDataActive:/);
    expect(src).toMatch(/serviceVirtualizationImageryActive:/);
    expect(src).toMatch(/serviceVirtualizationSessionActive:/);
  });
});

// =============================================================================
// 3. Gate truth tables — three predicates
// =============================================================================

import {
  isServiceVirtualizationContractActive,
  isServiceVirtualizationDataActive,
  isServiceVirtualizationImageryActive,
  isServiceVirtualizationSessionActive,
  isSvWorldSeedActive,
  isSvStoreLifecycleActive,
  isSvBodyLifecycleActive,
  isSvAuthFlowActive,
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
    { name: 'business + design-system', has: true, t: 'design-system', expected: false },
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

describe('isServiceVirtualizationSessionActive — gate truth table', () => {
  const cases: Array<{ name: string; has: boolean; t: string | undefined; expected: boolean }> = [
    { name: 'business + feature', has: true, t: 'feature', expected: true },
    { name: 'business + ui', has: true, t: 'ui', expected: true },
    { name: 'business + design-system', has: true, t: 'design-system', expected: false },
    { name: 'business + setup', has: true, t: 'setup', expected: true },
    { name: 'business + verification', has: true, t: 'verification', expected: false },
    { name: 'business + error', has: true, t: 'error', expected: false },
    { name: 'business + test-code', has: true, t: 'test-code', expected: false },
    { name: 'business + doc', has: true, t: 'doc', expected: false },
    { name: 'business + explain', has: true, t: 'explain', expected: false },
    { name: 'business + undefined', has: true, t: undefined, expected: false },
    { name: 'no business + feature', has: false, t: 'feature', expected: false },
    { name: 'no business + setup', has: false, t: 'setup', expected: false },
  ];
  for (const c of cases) {
    it(c.name, () => {
      expect(
        isServiceVirtualizationSessionActive({ hasBusinessConnection: c.has, taskType: c.t }),
      ).toBe(c.expected);
    });
  }
});

describe('isSvWorldSeedActive — block gate (band-routed)', () => {
  const cases: Array<{ name: string; has: boolean; t: string | undefined; band?: string; expected: boolean }> = [
    { name: 'business + feature @platform', has: true, t: 'feature', band: 'platform', expected: true },
    { name: 'business + feature @ordinary(undefined)', has: true, t: 'feature', band: undefined, expected: false },
    { name: 'business + feature @foundation', has: true, t: 'feature', band: 'foundation', expected: false },
    { name: 'business + feature @integration', has: true, t: 'feature', band: 'integration', expected: false },
    { name: 'business + setup', has: true, t: 'setup', expected: true },
    { name: 'business + ui', has: true, t: 'ui', expected: false },
    { name: 'business + design-system', has: true, t: 'design-system', expected: false },
    { name: 'no business + feature @platform', has: false, t: 'feature', band: 'platform', expected: false },
  ];
  for (const c of cases) {
    it(c.name, () => {
      expect(
        isSvWorldSeedActive({ hasBusinessConnection: c.has, taskType: c.t, band: c.band }),
      ).toBe(c.expected);
    });
  }
});

describe('isSvStoreLifecycleActive — block gate (store-owner-routed)', () => {
  // Store-lifecycle (write-path / single-instance) is owned by the store
  // author, so its gate is IDENTICAL to the world-seed owner — NOT the
  // renderable read consumer. A renderable non-platform feature/ui task that
  // only consumes the store must NOT receive these invariants.
  const cases: Array<{ name: string; has: boolean; t: string | undefined; band?: string; renderable?: boolean; expected: boolean }> = [
    { name: 'business + feature @platform', has: true, t: 'feature', band: 'platform', expected: true },
    { name: 'business + setup', has: true, t: 'setup', expected: true },
    { name: 'business + feature @ordinary + renderable=true (consumer only)', has: true, t: 'feature', band: undefined, renderable: true, expected: false },
    { name: 'business + ui + renderable=true (consumer only)', has: true, t: 'ui', renderable: true, expected: false },
    { name: 'business + feature @foundation', has: true, t: 'feature', band: 'foundation', expected: false },
    { name: 'no business + feature @platform', has: false, t: 'feature', band: 'platform', expected: false },
  ];
  for (const c of cases) {
    it(c.name, () => {
      expect(
        isSvStoreLifecycleActive({ hasBusinessConnection: c.has, taskType: c.t, band: c.band, renderable: c.renderable }),
      ).toBe(c.expected);
    });
  }

  it('relocation invariant — store-lifecycle gate equals world-seed owner gate for all inputs', () => {
    const tasks = ['feature', 'ui', 'setup', 'design-system', 'verification', undefined];
    const bands = ['platform', 'foundation', 'integration', undefined];
    for (const has of [true, false]) {
      for (const t of tasks) {
        for (const band of bands) {
          const input = { hasBusinessConnection: has, taskType: t, band, renderable: true };
          expect(isSvStoreLifecycleActive(input)).toBe(isSvWorldSeedActive(input));
        }
      }
    }
  });

  it('session-activation set is unchanged — store ⊆ world-seed, so the OR is not widened', () => {
    const tasks = ['feature', 'ui', 'setup', 'design-system', 'verification', undefined];
    const bands = ['platform', 'foundation', undefined];
    for (const has of [true, false]) {
      for (const t of tasks) {
        for (const band of bands) {
          for (const renderable of [true, false, undefined]) {
            const input = { hasBusinessConnection: has, taskType: t, band, renderable };
            const orOfBlocks =
              isSvWorldSeedActive(input) ||
              isSvStoreLifecycleActive(input) ||
              isSvBodyLifecycleActive(input) ||
              isSvAuthFlowActive(input);
            expect(isServiceVirtualizationSessionActive(input)).toBe(orOfBlocks);
          }
        }
      }
    }
  });
});

describe('isSvBodyLifecycleActive — block gate (renderable-routed)', () => {
  const cases: Array<{ name: string; has: boolean; renderable?: boolean; expected: boolean }> = [
    { name: 'business + renderable=true', has: true, renderable: true, expected: true },
    { name: 'business + renderable=false', has: true, renderable: false, expected: false },
    { name: 'business + renderable=undefined', has: true, renderable: undefined, expected: false },
    { name: 'no business + renderable=true', has: false, renderable: true, expected: false },
  ];
  for (const c of cases) {
    it(c.name, () => {
      expect(
        isSvBodyLifecycleActive({ hasBusinessConnection: c.has, renderable: c.renderable }),
      ).toBe(c.expected);
    });
  }
});

describe('isSvAuthFlowActive — block gate (taskType, narrowed in-body)', () => {
  const cases: Array<{ name: string; has: boolean; t: string | undefined; expected: boolean }> = [
    { name: 'business + feature', has: true, t: 'feature', expected: true },
    { name: 'business + ui', has: true, t: 'ui', expected: true },
    { name: 'business + setup', has: true, t: 'setup', expected: true },
    { name: 'business + design-system', has: true, t: 'design-system', expected: false },
    { name: 'business + verification', has: true, t: 'verification', expected: false },
    { name: 'business + undefined', has: true, t: undefined, expected: false },
    { name: 'no business + feature', has: false, t: 'feature', expected: false },
  ];
  for (const c of cases) {
    it(c.name, () => {
      expect(
        isSvAuthFlowActive({ hasBusinessConnection: c.has, taskType: c.t }),
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
  const SENTINEL_SESSION = 'Service Virtualization — Session';

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

    it(`${label} — session gate true → session body present`, async () => {
      const out = await adapter.render(templatePath, {
        serviceVirtualizationSessionActive: true,
      });
      expect(out).toContain(SENTINEL_SESSION);
    });

    it(`${label} — session gate false → session body absent`, async () => {
      const out = await adapter.render(templatePath, {
        serviceVirtualizationSessionActive: false,
      });
      expect(out).not.toContain(SENTINEL_SESSION);
    });

    it(`${label} — session store-lifecycle block routed to owner, not renderable consumer`, async () => {
      // Owner (store-lifecycle on, body-lifecycle off): Store block present,
      // Body block absent. This is the platform/setup adapter author.
      const owner = await adapter.render(templatePath, {
        serviceVirtualizationSessionActive: true,
        svStoreLifecycleActive: true,
        svBodyLifecycleActive: false,
      });
      expect(owner).toContain('Store Lifecycle');
      expect(owner).not.toContain('Body Lifecycle');

      // Read consumer (renderable surface): Body block present, Store block
      // absent — the write-path invariants must NOT leak to a pure consumer.
      const consumer = await adapter.render(templatePath, {
        serviceVirtualizationSessionActive: true,
        svStoreLifecycleActive: false,
        svBodyLifecycleActive: true,
      });
      expect(consumer).toContain('Body Lifecycle');
      expect(consumer).not.toContain('Store Lifecycle');
    });

    it(`${label} — all gates undefined → all bodies absent (default falsy)`, async () => {
      const out = await adapter.render(templatePath, {});
      expect(out).not.toContain(SENTINEL_CONTRACT);
      expect(out).not.toContain(SENTINEL_DATA);
      expect(out).not.toContain(SENTINEL_IMAGERY);
      expect(out).not.toContain(SENTINEL_SESSION);
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

describe('service-virtualization — request-responsiveness + per-authority fidelity (RCA: green-basing-helix)', () => {
  it('data partial mandates the read endpoint applies request inputs to the seeded dataset', () => {
    const src = fs.readFileSync(PARTIAL_DATA, 'utf-8');
    expect(src).toMatch(/Request-responsiveness/i);
    expect(src.toLowerCase()).toContain('seeded dataset');
    expect(src).toMatch(/filter, search, sort, pagination/i);
    expect(src).toMatch(/changing a selecting input changes the returned set/i);
  });

  it('session partial mandates per-authority fidelity (linked authority equals the chooser pick)', () => {
    const src = fs.readFileSync(PARTIAL_SESSION, 'utf-8');
    expect(src).toMatch(/linked-authority|linked authority/i);
    expect(src).toMatch(/the chooser actually picked|did not pick/i);
  });
});

describe('service-virtualization — navigable-target reachability owned by the always-on contract (RCA: misty-bringing-novel)', () => {
  // Root cause: the rule that rejects an unusable authorize URL lived ONLY in
  // the gated session auth-flow block, never on the reasoning path when the
  // authorize value was authored as one method among many on an omnibus data
  // adapter. The original always-on lift expressed the rule as a HOST blacklist
  // (`*.example` / third-party / `localhost:PORT`), so a host-less form (a
  // custom `mock://` scheme) slipped through every enumerated negative. Fix
  // restates usability as ONE positive property — a value the consumer's own
  // resolution mechanism can carry to completion against the running app the
  // app itself serves — which subsumes host-shaped AND form-shaped failures
  // without a catalogue; and forbids the deferred-stub (empty/absent body left
  // to an unnamed "later unit"). Session still defers to the contract rule.

  it('contract: defines a usable navigable target by a positive property — the running app itself serves it — NOT a host blacklist', () => {
    const src = read(PARTIAL_CONTRACT);
    expect(src).toMatch(/navigable target/i);
    // positive property: the running app/system itself answers it
    expect(src).toMatch(/running app itself serves|running system itself|the app can answer it/i);
    // the consumer's own resolution mechanism must be able to follow the form
    expect(src).toMatch(/resolution mechanism can carry|form .*can actually follow|can actually follow/i);
    // being free of an external host is explicitly NOT sufficient (no whack-a-mole)
    expect(src).toMatch(/free of an external host/i);
    // host blacklist removed — the enumerated placeholder host is gone
    expect(src).not.toMatch(/\*\.example/);
  });

  it('contract: the usability requirement binds every adapter method, stated as ONE positive property not a catalogue of bad shapes', () => {
    const src = read(PARTIAL_CONTRACT);
    expect(src).toMatch(/binds EVERY method|every method of every virtualized adapter/i);
    // explicitly targets the omnibus-adapter blind spot
    expect(src).toMatch(/folded among many data methods/i);
    // single positive property, not an enumeration of bad shapes
    expect(src).toMatch(/no catalogue of bad shapes|one property to satisfy|one\s+positive property/i);
  });

  it('contract: forbids the deferred-stub — a virtualized method returns a usable seeded value now, not an empty body deferred to a later unit', () => {
    const src = read(PARTIAL_CONTRACT);
    expect(src).toMatch(/later unit/i);
    expect(src).toMatch(/incomplete adapter/i);
    expect(src).toMatch(/permanently empty/i);
    // not a blanket empty ban — a legitimately empty surface is allowed
    expect(src).toMatch(/genuinely empty by design|empty by design is fine/i);
  });

  it('contract: parity rule is bounded — identical observable shape excludes mirroring an external host', () => {
    const src = read(PARTIAL_CONTRACT);
    expect(src).toMatch(/"Observable shape"/);
    expect(src).toMatch(/resolves INSIDE the closed system/);
    expect(src).toMatch(/never by\s+mirroring the external host/i);
  });

  it('session: auth-entry defers to the contract navigable-target rule and names the no-op-redirect defect', () => {
    const src = read(PARTIAL_SESSION);
    expect(src).toMatch(/navigable-target rule|navigable target/i);
    expect(src).toMatch(/service-virtualization-contract/);
    expect(src).toMatch(/no-op/i);
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
