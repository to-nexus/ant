/**
 * R5 self-check trailing message — turn detection helpers.
 *
 * The full docGen node test surface is too heavy for a unit test (it
 * runs an LLM stream + orchestrator + file renderer). Instead, this
 * test pins:
 *   - the artifact-mutation-intent detector logic (XML files / pending
 *     mutate tools on artifact paths trigger pending-done-check; same
 *     paths under `codebase/` do NOT — those are caught by the gate
 *     earlier),
 *   - the self-check trailing message helper used by spec / system
 *     intents (escalation 1 vs ≥2 wording, sectionScope inclusion).
 *
 * These two pieces own the entire R5 contract — the docGen node only
 * combines them with state plumbing.
 */

import { describe, it, expect } from 'vitest';
import { buildSelfCheckTrailingMessage } from '../../src/agents/architect/graph/design/nodes/docGen/intent/selfCheck';
import type { DesignGraphState } from '../../src/agents/architect/graph/design/state';

function stateStub(overrides: Partial<DesignGraphState> = {}): DesignGraphState {
  return {
    ...(overrides as any),
  } as DesignGraphState;
}

describe('R5 self-check trailing message helper', () => {
  it('returns undefined when _pendingDoneCheck is not set (no self-check needed)', () => {
    const out = buildSelfCheckTrailingMessage(stateStub({ _pendingDoneCheck: false }), {
      artifactPath: 'architecture/spec/foo.md',
    });
    expect(out).toBeUndefined();
  });

  it('escalation 1 — gentle self-check naming the artifact path and section scope', () => {
    const out = buildSelfCheckTrailingMessage(
      stateStub({ _pendingDoneCheck: true, _doneCheckEscalation: 1 }),
      {
        artifactPath: 'architecture/spec/foo.md',
        sectionScope: 'Section 2: API Contract',
      },
    );
    expect(out).toBeDefined();
    expect(out!).toMatch(/architecture\/spec\/foo\.md/);
    expect(out!).toMatch(/Section 2: API Contract/);
    expect(out!).toMatch(/Satisfied/);
    expect(out!).toMatch(/<done>true<\/done>/);
    // Must NOT enumerate tool names or include "You MUST" (FPOP discipline).
    expect(out!).not.toMatch(/edit_file|delete_file|run_command|You MUST/);
  });

  it('escalation 1 falls back to "full document" when sectionScope is empty', () => {
    const out = buildSelfCheckTrailingMessage(
      stateStub({ _pendingDoneCheck: true, _doneCheckEscalation: 1 }),
      {
        artifactPath: 'architecture/system/be-system-main.md',
        sectionScope: '',
      },
    );
    expect(out!).toMatch(/full document/);
  });

  it('escalation 2 — firmer reminder, still What-only and FPOP-clean', () => {
    const out = buildSelfCheckTrailingMessage(
      stateStub({ _pendingDoneCheck: true, _doneCheckEscalation: 2 }),
      {
        artifactPath: 'architecture/spec/foo.md',
        sectionScope: 'Section 1',
      },
    );
    expect(out).toBeDefined();
    expect(out!).toMatch(/Second self-check/);
    expect(out!).toMatch(/architecture\/spec\/foo\.md/);
    expect(out!).toMatch(/<done>true<\/done>/);
    expect(out!).not.toMatch(/edit_file|delete_file|run_command|You MUST/);
  });

  it('escalation ≥3 still uses the firmer (≥2) wording (no perpetual escalation)', () => {
    const out = buildSelfCheckTrailingMessage(
      stateStub({ _pendingDoneCheck: true, _doneCheckEscalation: 5 }),
      { artifactPath: 'architecture/spec/foo.md' },
    );
    expect(out!).toMatch(/Second self-check/);
  });
});
