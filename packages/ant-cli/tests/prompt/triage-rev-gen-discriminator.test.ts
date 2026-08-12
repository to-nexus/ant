/**
 * Wording lock (high-ironing-mouse RCA): triage's rev-* vs gen-* choice hinges
 * on the directive-form discriminator — a directive must CARRY a concrete
 * content delta for rev-*; a failure report on built behaviour routes to
 * gen-* from any stance. Commit 4480dc135 introduced this test as prose,
 * 75ac74388's declarative-matrix rewrite silently dropped it, and the
 * "여전히 X 안된다" → rev-spec false positive regressed. This lock fails if a
 * future rules.md rewrite drops the axis again.
 */
import { describe, it, expect } from 'vitest';

import { buildTriagePrompt } from '../../src/agents/common/graph/nodes/triage/index';
import { FilePromptAdapter } from '../../src/periphery/adapters/prompt/FilePromptAdapter';

const workspaceState = () =>
  ({
    hasPlan: false,
    hasMetaDirectives: false,
    hasAssets: false,
    hasFigmaConfig: false,
    hasVisualUi: false,
    hasVisualGameArt: false,
    hasArchitectureSystem: false,
    hasArchitectureSpec: true,
    specDocCount: 1,
    specDocNames: ['defect-fixes.md'],
    hasCodebase: false,
    hasDesignDoc: true,
  }) as any;

describe('triage rules.md — rev-vs-gen directive-form discriminator lock', () => {
  it('keeps the carried-delta / failure-report axis in the system prompt', async () => {
    const { system } = await buildTriagePrompt({
      domain: 'service',
      userInput: 'x',
      currentJob: 'design',
      currentAgent: 'architect',
      workspaceState: workspaceState(),
      promptPort: new FilePromptAdapter(),
    });

    // Hard Constraint 1 restores the (a)+(b) test from 4480dc135.
    expect(system).toContain('directive-carried delta');
    // Soft "Directive form" dimension: failure reports route gen-* from ANY stance.
    expect(system).toContain('failure report on built behaviour');
    // The design-stance carve-out that voted rev-* on boundary count alone is gone.
    expect(system).not.toContain('multi-boundary-ness signals EXTENDING');
  });

  /**
   * P1b (e2-humming-spindle / green-padding-drake RCA): the failure-report →
   * gen-* rule is qualified by the latest same-family artifact's consumption
   * state. Both directions are load-bearing:
   *  - consumed → gen-spec (the high-ironing-mouse direction, kept above)
   *  - pending  → rev-* absorption (green-padding-drake: a design job authored
   *    a spec 13 min earlier, no code job consumed it, and a follow-up problem
   *    report was mis-routed to gen-spec, creating a parallel second spec the
   *    user had to merge by hand)
   */
  it('keeps the pending-vs-consumed consumption axis (both directions)', async () => {
    const { system } = await buildTriagePrompt({
      domain: 'service',
      userInput: 'x',
      currentJob: 'design',
      currentAgent: 'architect',
      workspaceState: workspaceState(),
      promptPort: new FilePromptAdapter(),
    });

    // Pending direction: HC1 exception + gen-spec family guidance qualifier.
    // (Phrases kept short — markdown hard-wrapping splits longer literals.)
    expect(system).toContain('pending-artifact absorption');
    expect(system).toContain('not yet consumed');
    // Consumed direction survives: a report on consumed behaviour stays gen-*.
    expect(system).toContain('consumed downstream');
  });

  it('renders the consumption marker on prior-artifact breadcrumbs (user prompt)', async () => {
    const featureContext = {
      userTurns: [],
      breadcrumbs: [
        {
          type: 'breadcrumb', ts: '2026-01-01T00:00:00Z', jobId: 'j1',
          turnId: 't1', jobType: 'design', scope: 'modification',
          anchors: { files: ['architecture/spec/enemy-boss-behavior.md'] },
          summary: 'enemy/boss behavior spec', stats: {},
          consumption: 'pending',
        },
        {
          type: 'breadcrumb', ts: '2026-01-01T01:00:00Z', jobId: 'j2',
          turnId: 't2', jobType: 'design', scope: 'modification',
          anchors: { files: ['architecture/spec/older.md'] },
          summary: 'older spec', stats: {},
          consumption: 'consumed',
        },
      ],
    };

    const { user } = await buildTriagePrompt({
      domain: 'service',
      userInput: 'x',
      currentJob: 'design',
      currentAgent: 'architect',
      workspaceState: workspaceState(),
      featureContext,
      promptPort: new FilePromptAdapter(),
    });

    expect(user).toContain('[pending — not yet consumed by any code job]');
    expect(user).toContain('[consumed by a later code job]');
  });
});
