/**
 * Regression: Phase 3 — ant-source self-diagnosis is available to code·design.
 *
 * Guards three seams that must move together:
 *   1. Registries: code/design registries carry the ant-source handlers
 *      (shared TOOL_HANDLERS), so a tool call actually executes.
 *   2. Schemas: the LLM SEES the tools (ARCHITECT_TOOLS + code/design TOOL_SETS
 *      via getToolsByNames).
 *   3. Prompt: the `shared-source-diagnosis` guidance is injected ALWAYS-ON for
 *      code·design (not presence-gated), and NOT for planner.
 */

import { describe, it, expect } from 'vitest';
import {
  ToolName,
  TOOL_SETS,
} from '../../src/agents/common/tool/toolCatalog';
import {
  createCodeToolRegistry,
  createDesignToolRegistry,
  createPlanToolRegistry,
} from '../../src/agents/common/tool/presets';
import { ARCHITECT_TOOLS, getToolsByNames } from '../../src/agents/common/tool/toolSchemas';
import { ASK_TOOLS } from '../../src/agents/architect/graph/ask/tools';
import { AutoInjectionResolver } from '../../src/core/prompt/builder/AutoInjectionResolver';

const ANT_SOURCE = [ToolName.READ_ANT_SOURCE, ToolName.LIST_ANT_FILES, ToolName.SEARCH_ANT_CODE];
const DIAGNOSIS_PARTIAL = 'jobs/shared/injections/shared-source-diagnosis';

describe('ant-source self-diagnosis exposure (Phase 3-a)', () => {
  it('code + design registries execute the ant-source handlers', () => {
    const code = createCodeToolRegistry();
    const design = createDesignToolRegistry();
    for (const t of ANT_SOURCE) {
      expect(code.has(t)).toBe(true);
      expect(design.has(t)).toBe(true);
    }
  });

  it('plan job does NOT get ant-source tools (scoped to code·design)', () => {
    const plan = createPlanToolRegistry();
    for (const t of ANT_SOURCE) expect(plan.has(t)).toBe(false);
  });

  it('ARCHITECT_TOOLS declares schemas so the LLM sees the tools', () => {
    for (const t of ANT_SOURCE) {
      const schema = (ARCHITECT_TOOLS as Record<string, any>)[t];
      expect(schema, `missing ARCHITECT_TOOLS[${t}]`).toBeTruthy();
      expect(schema.name).toBe(t);
    }
  });

  it('code·design work tool-sets surface the ant-source schemas via getToolsByNames', () => {
    const sets = [
      TOOL_SETS.codeBasic, TOOL_SETS.planExplore, TOOL_SETS.codeExplain,
      TOOL_SETS.design, TOOL_SETS.designPlanExplore, TOOL_SETS.uiDesign,
    ];
    for (const set of sets) {
      const names = getToolsByNames([...set]).map(t => t.name);
      for (const t of ANT_SOURCE) expect(names).toContain(t);
    }
  });

  it('read_ant_source declares startLine/endLine (large-file tails must be reachable)', () => {
    const props = (ARCHITECT_TOOLS as Record<string, any>).read_ant_source.input_schema.properties;
    expect(props.startLine).toBeDefined();
    expect(props.endLine).toBeDefined();
  });

  it('ask duplicate schema converges on the shared input_schema by reference', () => {
    const askEntry = (ASK_TOOLS as Array<{ name: string; parameters: unknown }>).find(
      (t) => t.name === 'read_ant_source',
    );
    expect(askEntry?.parameters).toBe((ARCHITECT_TOOLS as Record<string, any>).read_ant_source.input_schema);
  });
});

describe('shared-source-diagnosis prompt injection (Phase 3-c)', () => {
  const resolver = new AutoInjectionResolver();
  const resolve = (job: string, node: 'plan' | 'execute') =>
    resolver.resolve({ job, node, data: {} });

  it('injected always-on for code (plan + execute), no data flag needed', () => {
    expect(resolve('code', 'execute')).toContain(DIAGNOSIS_PARTIAL);
    expect(resolve('code', 'plan')).toContain(DIAGNOSIS_PARTIAL);
  });

  it('injected always-on for design (plan + execute)', () => {
    expect(resolve('design', 'execute')).toContain(DIAGNOSIS_PARTIAL);
    expect(resolve('design', 'plan')).toContain(DIAGNOSIS_PARTIAL);
  });

  it('NOT injected for planner job', () => {
    expect(resolve('planner', 'plan')).not.toContain(DIAGNOSIS_PARTIAL);
  });
});
