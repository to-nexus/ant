import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Pin the SSOT shape of the dev-server lifecycle policy.
 *
 * The policy must satisfy three invariants:
 *
 *   1. The single rule "you start it, you stop it, before <done>" is the
 *      ONLY normative statement on lifecycle responsibility (no parallel
 *      definition that could drift).
 *   2. The five-step procedure (spawn / probe / stop / verify / done) is
 *      present so callers don't fall back to ambiguous prose.
 *   3. Every prompt that exposes `keep_running:true` semantics MUST
 *      `{{> ...persistent-process-policy}}` so the LLM sees the rule
 *      wherever it can spawn long-running processes. We assert this
 *      against the known set of execute / plan variants.
 *
 * Failure modes this regression-tests:
 *   - Someone copies the rule into a phase-specific prompt instead of
 *     importing the SSOT (definition drift).
 *   - Someone removes the import from one of the inject-sites, leaving
 *     LLMs in that variant blind to the rule.
 *   - Someone weakens the rule back to "the runtime tears it down" (the
 *     pre-fix wording that motivated the verification leak in the first
 *     place).
 */

const REPO_ROOT = path.resolve(__dirname, '../..');
const POLICY_PATH = path.join(
  REPO_ROOT,
  'src/core/prompt/templates/jobs/code/base/injections/persistent-process-policy.md',
);

const REQUIRED_INJECTION_SITES = [
  'src/core/prompt/templates/jobs/code/nodes/plan/variants/error/base.md',
  'src/core/prompt/templates/jobs/code/nodes/plan/variants/verification/rules.md',
  'src/core/prompt/templates/jobs/code/nodes/execute/variants/verification/rules.md',
  'src/core/prompt/templates/jobs/code/nodes/execute/variants/error/rules.md',
];

function readPolicy(): string {
  return fs.readFileSync(POLICY_PATH, 'utf-8');
}

describe('persistent-process-policy injection (SSOT)', () => {
  it('contains the single canonical rule wording', () => {
    const body = readPolicy();
    // The exact wording is the de-facto contract — paraphrasing it would
    // weaken the LLM's compliance signal. If you intend to edit it, edit
    // this test in the same change so the reviewer can see the diff.
    expect(body).toMatch(/You start it\. You stop it\. Before `<done>`\./);
  });

  it('lists the 5-step procedure (spawn / probe / stop / verify / emit)', () => {
    const body = readPolicy();
    // Grep for the step labels in order — both the headers and the
    // ordering matter; LLMs follow procedures more reliably when steps
    // are numbered and sequential.
    const stepLine = (label: string) =>
      new RegExp(`\\|\\s*\\d+\\s*\\|\\s*\\*\\*${label}`, 'i');
    for (const label of ['Spawn', 'Probe', 'Stop', 'Verify', 'Emit']) {
      expect(body).toMatch(stepLine(label));
    }
    // And the order must be exactly that.
    const positions = ['Spawn', 'Probe', 'Stop', 'Verify', 'Emit']
      .map(label => body.search(stepLine(label)));
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });

  it('does NOT instruct the LLM to skip explicit kill ("you do NOT need" wording)', () => {
    const body = readPolicy();
    // The pre-fix wording was "you do NOT need explicit kill commands"
    // which made the LLM treat the runtime sweep as the primary path.
    // Block any regression that brings it back.
    expect(body).not.toMatch(/you do NOT need explicit kill/i);
    expect(body).not.toMatch(/you don'?t need to kill/i);
  });

  it('frames the runtime sweep as a SAFETY NET, not the primary path', () => {
    const body = readPolicy();
    expect(body).toMatch(/safety net/i);
  });

  it('declares the policy DISABLED branch for non-error / non-verification contexts', () => {
    const body = readPolicy();
    // The else branch must remain — feature-task contexts that didn't
    // grant `keep_running:true` rely on this to refuse persistent processes.
    expect(body).toMatch(/Persistent Process Policy — DISABLED/);
  });
});

describe('persistent-process-policy — required inject sites', () => {
  for (const rel of REQUIRED_INJECTION_SITES) {
    it(`${rel} imports the policy partial`, () => {
      const full = path.join(REPO_ROOT, rel);
      const body = fs.readFileSync(full, 'utf-8');
      expect(body).toMatch(/\{\{>\s*jobs\/code\/base\/injections\/persistent-process-policy\s*\}\}/);
    });
  }
});

describe('verification done gate — single-rule reuse', () => {
  it('verification execute rules.md cites the policy from its done-gate (no rule duplication)', () => {
    const body = fs.readFileSync(
      path.join(REPO_ROOT, 'src/core/prompt/templates/jobs/code/nodes/execute/variants/verification/rules.md'),
      'utf-8',
    );
    // The Task Completion section must reference the same single rule —
    // we look for the canonical phrase to prove the reference is
    // pointing at the SSOT, not redefining the rule locally.
    expect(body).toMatch(/Persistent Process Policy/i);
    expect(body).toMatch(/keep_running:\s*true/);
  });

  it('verification execute base.md mentions the policy under Completion (no fresh rule)', () => {
    const body = fs.readFileSync(
      path.join(REPO_ROOT, 'src/core/prompt/templates/jobs/code/nodes/execute/variants/verification/base.md'),
      'utf-8',
    );
    expect(body).toMatch(/Persistent Process Policy/i);
  });
});
