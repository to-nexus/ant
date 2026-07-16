/**
 * ToolOrchestrator → explore dispatch: the orchestrator stamps
 * ctx.currentToolCallId before each handler call, so a real batch containing
 * `explore` launches with the tool_use id as the registry key and returns the
 * launch ack as the tool result (tool_use/tool_result pairing preserved).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ToolOrchestrator } from '../../src/agents/common/tool/orchestrator';
import { ToolRegistry } from '../../src/agents/common/tool/registry';
import { ToolName, TOOL_HANDLERS } from '../../src/agents/common/tool/toolCatalog';
import { createSubagentSeam } from '../../src/agents/common/subagent/seam';
import { clearAll, getEntry } from '../../src/agents/common/subagent/registry';
import { setLLMClientFactory } from '../../src/periphery/adapters/llm/LLMClientFactory';

beforeEach(() => {
  clearAll();
  setLLMClientFactory(() => ({
    modelName: 'mock',
    async *stream() { yield { type: 'text', text: 'child report' }; },
  }) as any);
});
afterEach(() => {
  clearAll();
  setLLMClientFactory(null);
});

describe('orchestrator explore dispatch', () => {
  it('executes a mixed batch — explore returns its ack immediately, keyed by tool_use id', async () => {
    const registry = new ToolRegistry();
    registry.register(ToolName.EXPLORE, TOOL_HANDLERS.get(ToolName.EXPLORE)!);
    registry.register(ToolName.READ_FILE, async () => ({ content: 'file body' }));

    const ctx: any = {
      fileSystem: {} as any,
      chatStatus: new Proxy({}, { get: () => async () => undefined }),
      workingDir: '/tmp',
    };
    ctx.subagent = createSubagentSeam({
      jobId: 'jobE',
      jobKind: 'code',
      llmJobType: 'code',
      baseCtx: ctx,
      registry,
      childTools: [],
      promptBuilder: { render: async () => 'sys' },
    });

    const orchestrator = new ToolOrchestrator({ registry });
    const result = await orchestrator.executeBatch(ctx, {
      calls: [
        { id: 'toolu_read1', name: 'read_file', args: { path: 'a.ts' } },
        { id: 'toolu_exp1', name: 'explore', args: { goal: 'investigate the auth flow' } },
      ],
    });

    expect(result.events).toHaveLength(2);
    const exploreEvent = result.events.find((e) => e.toolName === 'explore')!;
    expect(exploreEvent.result.error).toBeUndefined();
    expect(String(exploreEvent.result.content)).toContain('Subagent launched (id: toolu_exp1)');

    // Registry entry keyed by the tool_use id; settles via the mocked child.
    const entry = getEntry('toolu_exp1');
    expect(entry).toBeDefined();
    await entry!.promise;
    expect(entry!.result?.report).toBe('child report');
  });
});
