/**
 * explore handler + catalog policy pins:
 * - launch-ack text shape / denied / seam-absent graceful error
 * - depth-1: no `explore` in any subagent* child set
 * - EXPLORE present in all four JOB_TOOL_MATRIX rows
 * - child sets are strictly read-only
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleExplore } from '../../src/agents/common/tool/handlers/explore';
import { clearAll } from '../../src/agents/common/subagent/registry';
import { createSubagentSeam } from '../../src/agents/common/subagent/seam';
import { ToolRegistry } from '../../src/agents/common/tool/registry';
import {
  ToolName,
  JOB_TOOL_MATRIX,
  JobType,
  TOOL_SETS,
  TOOL_HANDLERS,
} from '../../src/agents/common/tool/toolCatalog';
import { ARCHITECT_TOOLS } from '../../src/agents/common/tool/toolSchemas';
import { setLLMClientFactory } from '../../src/periphery/adapters/llm/LLMClientFactory';

beforeEach(() => {
  clearAll();
  setLLMClientFactory(() => ({
    modelName: 'mock',
    async *stream() { yield { type: 'text', text: 'report' }; },
  }) as any);
});
afterEach(() => {
  clearAll();
  setLLMClientFactory(null);
});

function seamCtx(): any {
  const ctx: any = { fileSystem: {} as any, chatStatus: {} as any, workingDir: '/tmp' };
  ctx.subagent = createSubagentSeam({
    jobId: 'job-x',
    jobKind: 'code',
    llmJobType: 'code',
    baseCtx: ctx,
    registry: new ToolRegistry(),
    childTools: [],
    promptBuilder: { render: async () => 'sys' },
  });
  return ctx;
}

describe('handleExplore', () => {
  it('returns a graceful error when the seam is not wired (child / un-wired job)', async () => {
    const res = await handleExplore({ currentToolCallId: 'c1' } as any, { goal: 'g' });
    expect(res.error).toBeTruthy();
    expect(res.content).toContain('not available');
  });

  it('returns a graceful error when the orchestrator did not set a callId', async () => {
    const ctx = seamCtx();
    ctx.currentToolCallId = undefined;
    const res = await handleExplore(ctx, { goal: 'g' });
    expect(res.error).toBeTruthy();
  });

  it('launch ack pairs the callId with the report-marker contract', async () => {
    const ctx = seamCtx();
    ctx.currentToolCallId = 'toolu_abc123';
    const res = await handleExplore(ctx, { goal: 'find the auth flow' });
    expect(res.error).toBeUndefined();
    expect(res.content).toContain('Subagent launched (id: toolu_abc123)');
    expect(res.content).toContain('SUBAGENT REPORT');
    // Ack must NOT contain the literal pairing marker (orphan detection scans for it).
    expect(res.content).not.toContain('[SUBAGENT REPORT toolu_abc123]');
    expect(res.content).toContain('Continue your own work');
  });

  it('denies an empty goal without launching', async () => {
    const ctx = seamCtx();
    ctx.currentToolCallId = 'c2';
    const res = await handleExplore(ctx, { goal: '   ' });
    expect(res.error).toBeTruthy();
  });
});

describe('catalog policy pins', () => {
  const CHILD_SETS = ['subagentCode', 'subagentDesign', 'subagentPlanner', 'subagentAsk'] as const;

  it('EXPLORE is exposed in all four job matrices (always-on)', () => {
    for (const job of [JobType.CODE, JobType.DESIGN, JobType.PLAN, JobType.ASK]) {
      expect(JOB_TOOL_MATRIX[job]).toContain(ToolName.EXPLORE);
    }
  });

  it('depth-1: no child set contains explore', () => {
    for (const key of CHILD_SETS) {
      expect((TOOL_SETS as any)[key]).not.toContain(ToolName.EXPLORE);
    }
  });

  it('child sets are strictly read-only (no write / execute / figma / download)', () => {
    const forbidden = new Set([
      ToolName.EDIT_FILE, ToolName.CREATE_FILE, ToolName.DELETE_FILE, ToolName.MKDIR,
      ToolName.RUN_COMMAND, ToolName.HTTP_REQUEST, ToolName.DOWNLOAD_ASSET,
      ToolName.FIGMA_DESIGN_CTX, ToolName.FIGMA_SCREENSHOT, ToolName.FIGMA_METADATA,
      ToolName.FIGMA_VARIABLES, ToolName.FILE, ToolName.WRITE_FILE,
      ToolName.REGISTER_REFERENCE,
    ]);
    for (const key of CHILD_SETS) {
      for (const tool of (TOOL_SETS as any)[key] as ToolName[]) {
        expect(forbidden.has(tool), `${key} must not contain ${tool}`).toBe(false);
      }
    }
  });

  it('explore has a handler and a schema with async contract wording', () => {
    expect(TOOL_HANDLERS.get(ToolName.EXPLORE)).toBeTypeOf('function');
    const schema = ARCHITECT_TOOLS.explore;
    expect(schema.input_schema.required).toEqual(['goal']);
    expect(schema.description).toContain('IMMEDIATELY');
    expect(schema.description).toContain('[SUBAGENT REPORT');
  });

  it('SUBAGENT_REPORT rides along with every parent EXPLORE surface', () => {
    for (const job of [JobType.CODE, JobType.DESIGN, JobType.PLAN, JobType.ASK]) {
      expect(JOB_TOOL_MATRIX[job]).toContain(ToolName.SUBAGENT_REPORT);
    }
    for (const [key, tools] of Object.entries(TOOL_SETS)) {
      if ((tools as ToolName[]).includes(ToolName.EXPLORE)) {
        expect(tools, `${key} exposes explore but not subagent_report`).toContain(ToolName.SUBAGENT_REPORT);
      }
    }
  });

  it('depth-1: no child set contains subagent_report (children cannot drill parent reports)', () => {
    for (const key of CHILD_SETS) {
      expect((TOOL_SETS as any)[key]).not.toContain(ToolName.SUBAGENT_REPORT);
    }
  });

  it('subagent_report has a handler and an offset-paging schema', () => {
    expect(TOOL_HANDLERS.get(ToolName.SUBAGENT_REPORT)).toBeTypeOf('function');
    const schema = (ARCHITECT_TOOLS as any).subagent_report;
    expect(schema.input_schema.required).toEqual(['id']);
    expect(schema.input_schema.properties.offset).toBeTruthy();
    // Marker-pairing invariant: the schema description must not embed the marker literal.
    expect(schema.description).not.toContain('[SUBAGENT REPORT');
  });
});
