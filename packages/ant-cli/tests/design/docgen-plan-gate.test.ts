/**
 * docGen tool-set plan gate.
 *
 * After the plan→docGen role split was restored
 * (`.claude/plans/plan-docgen-parallel-spring.md`), `getTools()` for the
 * design docGen node must drop `search_web` whenever `state.planText` is
 * a sealed `<plan>` body. Plan owns external/architectural exploration;
 * docGen is for path / signature / contract verification only — same
 * boundary code job draws between `TOOL_SETS.planExplore` and
 * `TOOL_SETS.codeBasic`.
 *
 * These tests lock the gate against three regression vectors:
 *   - sealed planText: SEARCH_WEB must be filtered out.
 *   - empty planText (legacy / dispatcher fallback): SEARCH_WEB stays
 *     so the original Codebase Exploration heuristic still runs.
 *   - whitespace-only planText: treated as empty (matches the same
 *     trim-then-check predicate the rules.md `{{#if planText}}` gate
 *     uses via Handlebars string-truthiness on the cleaned value).
 */

import { describe, it, expect } from 'vitest';
import { getTools } from '../../src/agents/architect/graph/design/nodes/docGen/tools';
import { ToolName } from '../../src/agents/common/tool/toolCatalog';
import type { DesignGraphState } from '../../src/agents/architect/graph/design/state';

function makeState(overrides: Partial<DesignGraphState> = {}): DesignGraphState {
  return {
    resolvedAction: { intentGroup: 'design-spec', intent: 'gen-code-spec', mode: 'generate', source: 'infer', hasExplicitFields: false },
    figmaConfig: undefined,
    figmaAvailable: false,
    planText: '',
    ...overrides,
  } as unknown as DesignGraphState;
}

const SEALED_PLAN = JSON.stringify({
  task: { id: 't', goal: 'demo' },
  candidateSolutions: [{ name: 'A' }, { name: 'B' }],
  decision: { selected: 'A', rationale: 'simpler' },
  documentOutline: [{ section: 'Overview', content: 'x' }],
});

describe('docGen getTools — planText gate', () => {
  it('drops search_web when planText is a sealed plan body (design-spec)', async () => {
    const tools = await getTools(makeState({ planText: SEALED_PLAN }));
    const names = tools.map(t => t.name);
    expect(names).not.toContain(ToolName.SEARCH_WEB);
    // Path / symbol verification tools remain for precision-checking.
    expect(names).toContain(ToolName.READ_FILE);
    expect(names).toContain(ToolName.LIST_FILES);
    expect(names).toContain(ToolName.SEARCH_CODE);
  });

  it('keeps search_web when planText is empty (legacy / dispatcher fallback)', async () => {
    const tools = await getTools(makeState({ planText: '' }));
    const names = tools.map(t => t.name);
    expect(names).toContain(ToolName.SEARCH_WEB);
  });

  it('treats whitespace-only planText as empty (gate fires on trimmed length)', async () => {
    const tools = await getTools(makeState({ planText: '   \n\t  ' }));
    const names = tools.map(t => t.name);
    expect(names).toContain(ToolName.SEARCH_WEB);
  });

  it('drops search_web for design-system-design intent when sealed', async () => {
    const tools = await getTools(makeState({
      resolvedAction: { intentGroup: 'design-system-design', intent: 'gen-code-sys', mode: 'generate', source: 'infer', hasExplicitFields: false } as any,
      planText: SEALED_PLAN,
    }));
    const names = tools.map(t => t.name);
    expect(names).not.toContain(ToolName.SEARCH_WEB);
  });

  it('design-ui intent never carries search_web (no regression introduced by the gate)', async () => {
    const noPlan = await getTools(makeState({
      resolvedAction: { intentGroup: 'design-ui', intent: 'gen-ui-desc', mode: 'generate', source: 'infer', hasExplicitFields: false } as any,
      planText: '',
    }));
    const sealedPlan = await getTools(makeState({
      resolvedAction: { intentGroup: 'design-ui', intent: 'gen-ui-desc', mode: 'generate', source: 'infer', hasExplicitFields: false } as any,
      planText: SEALED_PLAN,
    }));
    expect(noPlan.map(t => t.name)).not.toContain(ToolName.SEARCH_WEB);
    expect(sealedPlan.map(t => t.name)).not.toContain(ToolName.SEARCH_WEB);
  });
});
