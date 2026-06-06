import { describe, expect, it } from 'vitest';

import { getTools as getExecuteTools } from '../../src/agents/architect/graph/code/nodes/execute/tools';
import { getTools as getPlanTools } from '../../src/agents/architect/graph/code/nodes/plan/tools';
import {
  JOB_TOOL_MATRIX,
  JobType,
  TOOL_DISPLAY_NAMES,
  TOOL_HANDLERS,
  ToolName,
} from '../../src/agents/common/tool/toolCatalog';

const names = async (tools: Promise<any[]>) => (await tools).map(t => t.name);

describe('http_request tool exposure (gated by persistent processes)', () => {
  it('execute: included for an error task, absent for a plain feature task', async () => {
    const errState: any = { currentTask: { type: 'error' }, resolvedAction: { mode: 'generate' } };
    const featState: any = { currentTask: { type: 'feature' }, resolvedAction: { mode: 'generate' } };
    expect(await names(getExecuteTools(errState))).toContain('http_request');
    expect(await names(getExecuteTools(featState))).not.toContain('http_request');
  });

  it('execute: absent in explain mode', async () => {
    const explainState: any = { currentTask: { type: 'error' }, resolvedAction: { mode: 'explain' } };
    expect(await names(getExecuteTools(explainState))).not.toContain('http_request');
  });

  it('plan: included for verify-mode RCA and when a runtime-error directive grounds the cycle; absent for a locked apply task', async () => {
    const verState: any = { currentTask: { type: 'verification' }, directive: 'page throws TypeError at runtime' };
    // A fresh verification task enters verify-mode on cycle 1 (handleFreshTaskEntry
    // sets _verifyEntered), so its diagnostic RCA plan exposes http_request.
    const verifyModeState: any = { currentTask: { type: 'verification' }, _verifyEntered: true };
    // A plain feature apply task (not in a verify cycle) stays locked.
    const lockedState: any = { currentTask: { type: 'feature' }, completedTasksDetails: [] };
    expect(await names(getPlanTools(verState))).toContain('http_request');
    expect(await names(getPlanTools(verifyModeState))).toContain('http_request');
    expect(await names(getPlanTools(lockedState))).not.toContain('http_request');
  });
});

describe('http_request registration consistency (toolCatalog SSOT)', () => {
  it('is present in the enum, display names, handlers, and the CODE job matrix only', () => {
    expect(ToolName.HTTP_REQUEST).toBe('http_request');
    expect(TOOL_DISPLAY_NAMES[ToolName.HTTP_REQUEST]).toBeTruthy();
    expect(TOOL_HANDLERS.has(ToolName.HTTP_REQUEST)).toBe(true);
    expect(JOB_TOOL_MATRIX[JobType.CODE]).toContain(ToolName.HTTP_REQUEST);
    expect(JOB_TOOL_MATRIX[JobType.DESIGN]).not.toContain(ToolName.HTTP_REQUEST);
    expect(JOB_TOOL_MATRIX[JobType.PLAN]).not.toContain(ToolName.HTTP_REQUEST);
    expect(JOB_TOOL_MATRIX[JobType.ASK]).not.toContain(ToolName.HTTP_REQUEST);
  });
});
