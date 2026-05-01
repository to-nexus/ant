/**
 * mock-content-imagery — companion to mock-adapter-contract for image
 * slots fed by user-uploaded / DB-fetched content (NOT design-system
 * assets, which are governed by `ui-assets.json`, NOR mock data body,
 * which is governed by `mock-adapter-contract`).
 *
 * Gate axis (SBS):
 *   service domain × frontend stack × feature task
 *
 * Wire pattern: Handlebars-gated `{{> }}` partial-include in BOTH
 * `plan/rules.md` and `execute/variants/default/rules.md`, mirroring
 * the unconditional pattern of `mock-adapter-contract` but with a
 * 3-axis gate. AutoInjectionResolver is intentionally NOT used — plan
 * node calls `PromptBuilder.render()` which bypasses auto-injections.
 *
 * This guard locks:
 *   1. partial body language/platform neutrality + game-vocabulary absence
 *   2. partial-include presence at the two gate sites
 *   3. gate axis variables surrounding the include (no drift)
 *   4. `hasFrontend` injection in `buildMessages.ts` vars (execute side)
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..');
const TEMPLATES_ROOT = path.join(REPO_ROOT, 'src/core/prompt/templates');
const PARTIAL_PATH = path.join(
  TEMPLATES_ROOT,
  'jobs/code/base/injections/mock-content-imagery.md',
);
const PLAN_RULES = path.join(
  TEMPLATES_ROOT,
  'jobs/code/nodes/plan/rules.md',
);
const EXECUTE_RULES = path.join(
  TEMPLATES_ROOT,
  'jobs/code/nodes/execute/variants/default/rules.md',
);
const BUILD_MESSAGES = path.join(
  REPO_ROOT,
  'src/agents/architect/graph/code/nodes/execute/buildMessages.ts',
);

const PARTIAL_INCLUDE = '{{> jobs/code/base/injections/mock-content-imagery}}';

function read(p: string): string {
  return fs.readFileSync(p, 'utf-8');
}

describe('mock-content-imagery — partial body discipline', () => {
  it('partial file exists', () => {
    expect(fs.existsSync(PARTIAL_PATH)).toBe(true);
  });

  it('body is English-only (no Korean / non-Latin code points)', () => {
    const src = read(PARTIAL_PATH);
    // Hangul block — sufficient to detect Korean prose; CJK punctuation
    // unrelated to language is not used in prompt templates here.
    const hangul = src.match(/[\uAC00-\uD7A3]/g);
    expect(hangul, `Korean characters detected in ${PARTIAL_PATH}`).toBeNull();
  });

  it('body does NOT cite platform-specific names (FPOP §3 — Language & platform neutrality)', () => {
    const src = read(PARTIAL_PATH);
    // Word-boundary scan to avoid hitting unrelated substrings (e.g. "react"
    // inside "reaction"). The list mirrors `.cursorrules` / CLAUDE.md.
    const banned = ['React', 'Tailwind', 'Next\\.js', 'Vue', 'Svelte', 'Angular'];
    for (const word of banned) {
      const re = new RegExp(`\\b${word}\\b`);
      expect(re.test(src), `platform-specific term '${word}' present in ${PARTIAL_PATH}`).toBe(false);
    }
  });

  it('body does NOT leak game-domain vocabulary (Domain-Surface Boundary I7)', () => {
    const src = read(PARTIAL_PATH);
    // service-domain partial — game surface vocabulary is forbidden.
    const banned = ['sprite', 'OscillatorNode', 'particle', 'projectile'];
    for (const word of banned) {
      const re = new RegExp(`\\b${word}\\b`, 'i');
      expect(re.test(src), `game-domain term '${word}' present in ${PARTIAL_PATH}`).toBe(false);
    }
  });

  it('body shares the USE_MOCK env-var contract with mock-adapter-contract', () => {
    const src = read(PARTIAL_PATH);
    expect(
      src.includes('USE_MOCK'),
      'partial MUST cite USE_MOCK to share activation with mock-adapter-contract',
    ).toBe(true);
  });

  it('body declares the three pathway categories (categorized — SBS-required)', () => {
    const src = read(PARTIAL_PATH);
    // The three pathways MUST appear by their canonical labels so the
    // LLM is shown a stable taxonomy rather than ad-hoc method talk.
    expect(src).toMatch(/Inline SVG/);
    expect(src).toMatch(/Existing library|library/);
    expect(src).toMatch(/External placeholder service|placeholder service/);
  });
});

describe('mock-content-imagery — wire sites at plan + execute', () => {
  it('plan/rules.md includes the partial', () => {
    const src = read(PLAN_RULES);
    expect(src.includes(PARTIAL_INCLUDE)).toBe(true);
  });

  it('execute/variants/default/rules.md includes the partial', () => {
    const src = read(EXECUTE_RULES);
    expect(src.includes(PARTIAL_INCLUDE)).toBe(true);
  });

  it('plan-side include is wrapped by single boolean gate (Domain-Branching Locality I1)', () => {
    const src = read(PLAN_RULES);
    const idx = src.indexOf(PARTIAL_INCLUDE);
    expect(idx).toBeGreaterThan(-1);
    // 게이트는 단일 boolean (mockContentImageryActive). 도메인 비교는
    // 코드 helper(`isMockContentImageryActive`)가 담당. 템플릿 안에
    // `domain === 'service'` 류 비교가 들어가면 I1 가드가 fail.
    const window = src.slice(Math.max(0, idx - 400), idx);
    expect(window, 'plan gate missing mockContentImageryActive').toMatch(/mockContentImageryActive/);
    expect(window, 'plan gate must NOT compare domain in template').not.toMatch(/eq\s+resolvedAction\.domain\s+"service"/);
  });

  it('execute-side include is wrapped by single boolean gate (Domain-Branching Locality I1)', () => {
    const src = read(EXECUTE_RULES);
    const idx = src.indexOf(PARTIAL_INCLUDE);
    expect(idx).toBeGreaterThan(-1);
    const window = src.slice(Math.max(0, idx - 400), idx);
    expect(window, 'execute gate missing mockContentImageryActive').toMatch(/mockContentImageryActive/);
    expect(window, 'execute gate must NOT compare domain in template').not.toMatch(/eq\s+resolvedAction\.domain\s+"service"/);
  });
});

describe('mock-content-imagery — wiring at call sites', () => {
  it('buildMessages.ts injects hasFrontend/hasBackend + mockContentImageryActive', () => {
    const src = read(BUILD_MESSAGES);
    expect(src).toMatch(/AutoInjectionResolver\.computeStackFlags\s*\(/);
    expect(src).toMatch(/\bhasFrontend\b[\s\S]{0,400}\bhasBackend\b/);
    expect(src).toMatch(/isMockContentImageryActive\s*\(/);
    expect(src).toMatch(/mockContentImageryActive:/);
  });

  it('llm/prompt.ts injects mockContentImageryActive in the plan/base render vars', () => {
    const PLAN_GEN = path.join(
      REPO_ROOT,
      'src/agents/architect/graph/code/nodes/plan/llm/prompt.ts',
    );
    const src = read(PLAN_GEN);
    expect(src).toMatch(/isMockContentImageryActive\s*\(/);
    expect(src).toMatch(/mockContentImageryActive:/);
  });
});

// ============================================
// Helper unit tests — `isMockContentImageryActive`
// ============================================

import { isMockContentImageryActive } from '../src/core/prompt/builder/mockContentImageryGate';

describe('isMockContentImageryActive — gate truth table', () => {
  // Single SSOT predicate. `true` iff all three axes pass:
  //   service domain × frontend stack × feature task.
  const cases: Array<{
    name: string;
    domain: string | undefined;
    hasFrontend: boolean;
    taskType: string | undefined;
    expected: boolean;
  }> = [
    { name: 'service + FE + feature', domain: 'service', hasFrontend: true, taskType: 'feature', expected: true },
    { name: 'service + FE + ui', domain: 'service', hasFrontend: true, taskType: 'ui', expected: false },
    { name: 'service + FE + design-system', domain: 'service', hasFrontend: true, taskType: 'design-system', expected: false },
    { name: 'service + FE + setup', domain: 'service', hasFrontend: true, taskType: 'setup', expected: false },
    { name: 'service + FE + error', domain: 'service', hasFrontend: true, taskType: 'error', expected: false },
    { name: 'service + FE + verification', domain: 'service', hasFrontend: true, taskType: 'verification', expected: false },
    { name: 'service + FE + test-code', domain: 'service', hasFrontend: true, taskType: 'test-code', expected: false },
    { name: 'service + FE + undefined task', domain: 'service', hasFrontend: true, taskType: undefined, expected: false },
    { name: 'service + BE + feature', domain: 'service', hasFrontend: false, taskType: 'feature', expected: false },
    { name: 'game + FE + feature', domain: 'game', hasFrontend: true, taskType: 'feature', expected: false },
    { name: 'undefined domain + FE + feature', domain: undefined, hasFrontend: true, taskType: 'feature', expected: false },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(
        isMockContentImageryActive({
          hasFrontend: c.hasFrontend,
          domain: c.domain,
          taskType: c.taskType,
        }),
      ).toBe(c.expected);
    });
  }
});

// ============================================
// End-to-end gate render — actual Handlebars
// ============================================

import { FilePromptAdapter, initPartials } from '../src/periphery/adapters/prompt/FilePromptAdapter';
import { beforeAll } from 'vitest';

describe('mock-content-imagery — Handlebars boolean gate render', () => {
  let adapter: FilePromptAdapter;

  // SENTINEL appears ONLY in mock-content-imagery body — used to assert
  // partial inclusion after rendering the wrapping rules.md file.
  const SENTINEL = 'Mock Content Imagery';

  beforeAll(async () => {
    await initPartials(TEMPLATES_ROOT);
    adapter = new FilePromptAdapter(TEMPLATES_ROOT);
  });

  // Both nodes use the SAME `mockContentImageryActive` boolean — gate
  // semantics are owned by the helper (tested above). Here we only need
  // to verify that the boolean drives the {{#if}} correctly in BOTH
  // template files, no domain-name comparison leaked into templates.
  it('plan/rules — mockContentImageryActive=true → partial body present', async () => {
    const out = await adapter.render('jobs/code/nodes/plan/rules', {
      mockContentImageryActive: true,
    });
    expect(out).toContain(SENTINEL);
  });

  it('plan/rules — mockContentImageryActive=false → partial body absent', async () => {
    const out = await adapter.render('jobs/code/nodes/plan/rules', {
      mockContentImageryActive: false,
    });
    expect(out).not.toContain(SENTINEL);
  });

  it('plan/rules — mockContentImageryActive missing → partial body absent (default falsy)', async () => {
    const out = await adapter.render('jobs/code/nodes/plan/rules', {});
    expect(out).not.toContain(SENTINEL);
  });

  it('execute/rules — mockContentImageryActive=true → partial body present', async () => {
    const out = await adapter.render('jobs/code/nodes/execute/variants/default/rules', {
      mockContentImageryActive: true,
    });
    expect(out).toContain(SENTINEL);
  });

  it('execute/rules — mockContentImageryActive=false → partial body absent', async () => {
    const out = await adapter.render('jobs/code/nodes/execute/variants/default/rules', {
      mockContentImageryActive: false,
    });
    expect(out).not.toContain(SENTINEL);
  });

  it('execute/rules — mockContentImageryActive missing → partial body absent (default falsy)', async () => {
    const out = await adapter.render('jobs/code/nodes/execute/variants/default/rules', {});
    expect(out).not.toContain(SENTINEL);
  });
});
