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
});
