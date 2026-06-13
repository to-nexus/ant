/**
 * Operable-loop authoring-gap regression guard (plain-dimming-flock RCA).
 *
 * Closes two genuinely-missing injection gaps that left generated apps
 * render-complete but not operate-complete:
 *
 *   A1 — decompose "action-affordance flow closure": every mandated action
 *        affordance has an owning destination flow (inline or a named task).
 *   A2 — plan Remaining Tasks block carries the POSITIVE cross-task wiring
 *        clause (wire an affordance to a sibling-owned flow's entry, never a
 *        stub) — NOT a new manifest channel (the forward `remainingTasks`
 *        signal already exists; a new `renderPlannedSiblingEntries` helper was
 *        rejected as fragmentation).
 *   C  — session-lifecycle completeness: an authenticated session rehydrates
 *        its full identity-bearing state across restart. SV-INDEPENDENT (no
 *        hasBusinessConnection precondition) — true production behavior.
 *
 * This guard does NOT re-assert the present execute "wire every control" prose
 * (that was already on-path; A is closed upstream).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { isAuthSessionLifecycleActive } from '../../src/core/prompt/builder/authSessionGate';

const REPO_ROOT = path.resolve(__dirname, '../..');
const TEMPLATES_ROOT = path.join(REPO_ROOT, 'src/core/prompt/templates');
const DECOMPOSE_RULES = path.join(
  TEMPLATES_ROOT,
  'jobs/code/nodes/decompose/variants/default/rules.md',
);
const PLAN_BASE = path.join(TEMPLATES_ROOT, 'jobs/code/nodes/plan/base.md');
const PLAN_RULES = path.join(TEMPLATES_ROOT, 'jobs/code/nodes/plan/rules.md');
const EXECUTE_RULES = path.join(
  TEMPLATES_ROOT,
  'jobs/code/nodes/execute/variants/default/rules.md',
);
const SESSION_PARTIAL = path.join(
  TEMPLATES_ROOT,
  'jobs/code/base/injections/session-lifecycle-completeness.md',
);
const SRC_ROOT = path.join(REPO_ROOT, 'src');

const read = (p: string): string => fs.readFileSync(p, 'utf8');

// =============================================================================
// A1 — decompose action-affordance flow closure
// =============================================================================

describe('A1 — decompose action-affordance flow closure', () => {
  const body = read(DECOMPOSE_RULES);

  it('declares the action-affordance flow closure constraint', () => {
    expect(body).toContain('action-affordance flow closure');
  });

  it('requires a single owning destination flow (inline or named task)', () => {
    expect(body).toMatch(/destination flow/i);
    expect(body).toMatch(/dead control by construction/i);
  });

  it('sits under the Closure machinery (after auth/identity boundary closure)', () => {
    expect(body.indexOf('auth/identity boundary closure')).toBeLessThan(
      body.indexOf('action-affordance flow closure'),
    );
  });

  it('FPOP-neutral — no framework/route examples in the constraint', () => {
    expect(body).not.toMatch(/React|Next\.js|router\.push|onClick/);
  });
});

// =============================================================================
// A2 — plan Remaining Tasks positive wiring clause (no new manifest channel)
// =============================================================================

describe('A2 — plan sibling-flow wiring clause', () => {
  const body = read(PLAN_BASE);

  it('adds the positive wiring clause inside the Remaining Tasks block', () => {
    expect(body).toContain('Wiring to a sibling-owned flow');
    expect(body).toMatch(/named\s+entry/i);
    expect(body).toMatch(/dead-control defect/i);
    // must live under the existing Remaining Tasks gate, not a new section
    expect(body.indexOf('{{#if hasRemainingTasks}}')).toBeLessThan(
      body.indexOf('Wiring to a sibling-owned flow'),
    );
  });

  it('does NOT introduce a forward sibling-route manifest helper (anti-fragmentation)', () => {
    // The forward signal already exists via `remainingTasks`; a parallel
    // `renderPlannedSiblingEntries` channel was rejected.
    const hit = walkTs(SRC_ROOT).some((f) =>
      read(f).includes('renderPlannedSiblingEntries'),
    );
    expect(hit).toBe(false);
  });
});

// =============================================================================
// C — session-lifecycle completeness gate + partial
// =============================================================================

describe('C — isAuthSessionLifecycleActive gate (SV-independent owner)', () => {
  const cases: Array<{
    name: string;
    taskType: string | undefined;
    band?: string;
    expected: boolean;
  }> = [
    { name: 'feature @platform → owner', taskType: 'feature', band: 'platform', expected: true },
    { name: 'setup → scaffolder', taskType: 'setup', expected: true },
    { name: 'feature @foundation → not owner', taskType: 'feature', band: 'foundation', expected: false },
    { name: 'ordinary feature (no band) → not owner', taskType: 'feature', band: undefined, expected: false },
    { name: 'ui → read consumer, not owner', taskType: 'ui', expected: false },
    { name: 'undefined → off', taskType: undefined, expected: false },
  ];
  for (const c of cases) {
    it(c.name, () => {
      expect(isAuthSessionLifecycleActive({ taskType: c.taskType, band: c.band })).toBe(
        c.expected,
      );
    });
  }

  it('SV-independence — gate input carries NO hasBusinessConnection field', () => {
    // The gate must fire for prod / FE-only auth regardless of business
    // connection. Passing hasBusinessConnection is meaningless here; the
    // result depends only on taskType/band.
    const withFlag = isAuthSessionLifecycleActive({
      taskType: 'feature',
      band: 'platform',
      // @ts-expect-error — hasBusinessConnection is intentionally not part of the input
      hasBusinessConnection: false,
    });
    expect(withFlag).toBe(true);
  });
});

describe('C — session-lifecycle partial + wire sites', () => {
  const partial = read(SESSION_PARTIAL);

  it('partial states the rehydrate round-trip', () => {
    expect(partial).toMatch(/rehydrate/i);
    expect(partial).toMatch(/identity-bearing state/i);
    expect(partial).toMatch(/client-durable store/i);
  });

  it('reconciles with the auth-flow no-default rule (prior choice ≠ default)', () => {
    expect(partial).toMatch(/previously and deliberately chosen/i);
    expect(partial).toMatch(/never invent a default/i);
  });

  it('FPOP-neutral — no React/localStorage/token/cookie naming', () => {
    expect(partial).not.toMatch(/React|localStorage|sessionStorage|cookie|useEffect|token/i);
  });

  it('included in plan + execute rules under its OWN gate, separate from the SV session block', () => {
    for (const rules of [read(PLAN_RULES), read(EXECUTE_RULES)]) {
      expect(rules).toContain('{{#if authSessionLifecycleActive}}');
      expect(rules).toContain(
        '{{> jobs/code/base/injections/session-lifecycle-completeness}}',
      );
      // distinct gate from SV session — not folded into hasBusinessConnection
      expect(rules).toContain('{{#if serviceVirtualizationSessionActive}}');
    }
  });
});

// ---------------------------------------------------------------------------
// helper — shallow .ts walk under src
// ---------------------------------------------------------------------------
function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      out.push(...walkTs(full));
    } else if (entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}
