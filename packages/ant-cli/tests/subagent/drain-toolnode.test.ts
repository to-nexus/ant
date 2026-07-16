/**
 * Factory-level drain in createToolNode:
 * - settled reports are appended to the tool_result user message
 *   (after results/manifest, before extraContent)
 * - folded token delta survives a buildReturn that ignores hookUpdates
 *   (planner/ask shape) — merged after buildReturn
 * - LOST notification for orphaned acks rides the same drain
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createToolNode } from '../../src/agents/common/tool/createToolNode';
import { ToolRegistry } from '../../src/agents/common/tool/registry';
import { ToolName } from '../../src/agents/common/tool/toolCatalog';
import { launchEntry, clearAll } from '../../src/agents/common/subagent/registry';
import { buildLaunchAck } from '../../src/agents/common/subagent/drain';
import type { SubagentResult } from '../../src/agents/common/subagent/types';

const OWNER = 'jobD:_main_';

interface FakeState {
  history: any[];
  pending: Array<{ id: string; name: string; args: any }>;
  tokenUsage: { inputTokens: number; outputTokens: number; totalTokens: number };
  tokenUsageByModel: Record<string, any>;
}

function makeNode() {
  const registry = new ToolRegistry();
  registry.register(ToolName.READ_FILE, async () => ({ content: 'file body' }));

  return createToolNode<FakeState>({
    getPendingCalls: (s) => s.pending,
    buildContext: (s) => ({
      fileSystem: {} as any,
      chatStatus: new Proxy({}, { get: () => async () => undefined }) as any,
      workingDir: '/tmp',
      subagent: { ownerKey: OWNER, jobKind: 'code', launch: async () => ({ denied: 'n/a' }) },
    }) as any,
    registry,
    getHistory: (s) => s.history,
    hooks: {
      buildExtraUserContent: () => [{ type: 'text', text: '[TASK REMINDER]' }],
    },
    // Planner/ask shape: ignores hookUpdates and token channels entirely.
    buildReturn: (s, { updatedHistory }) => ({ history: updatedHistory, pending: [] } as any),
  });
}

beforeEach(() => clearAll());
afterEach(() => clearAll());

async function settle(id: string, result: SubagentResult): Promise<void> {
  const e = launchEntry({ id, ownerKey: OWNER, goal: 'g', run: () => Promise.resolve(result) });
  await (e as any).promise;
}

describe('createToolNode subagent drain', () => {
  it('delivers settled reports inside the tool_result user message, before extras', async () => {
    await settle('r1', { report: 'found the thing', rounds: 1, state: 'done' });
    const node = makeNode();
    const out: any = await node({
      history: [], pending: [{ id: 't1', name: 'read_file', args: { path: 'a.ts' } }],
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      tokenUsageByModel: {},
    });

    const lastUser = out.history[out.history.length - 1];
    const texts = (lastUser.content as any[]).map((b) => (typeof b.text === 'string' ? b.text : ''));
    const reportIdx = texts.findIndex((t) => t.includes('[SUBAGENT REPORT r1]'));
    const reminderIdx = texts.findIndex((t) => t.includes('[TASK REMINDER]'));
    expect(reportIdx).toBeGreaterThan(-1);
    expect(reminderIdx).toBeGreaterThan(reportIdx); // reminder stays last (recency contract)
  });

  it('token delta survives a buildReturn that ignores hookUpdates', async () => {
    await settle('r2', {
      report: 'r', rounds: 1, state: 'done', modelId: 'child-m',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    });
    const node = makeNode();
    const out: any = await node({
      history: [], pending: [{ id: 't1', name: 'read_file', args: { path: 'a.ts' } }],
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      tokenUsageByModel: {},
    });
    expect(out.tokenUsage.totalTokens).toBe(15);
    expect(out.tokenUsageByModel['child-m'].totalTokens).toBe(15);
  });

  it('orphaned launch-ack in history yields a LOST notification', async () => {
    const node = makeNode();
    const out: any = await node({
      history: [
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'gone', content: buildLaunchAck('gone', 'old goal') }] },
      ],
      pending: [{ id: 't1', name: 'read_file', args: { path: 'a.ts' } }],
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      tokenUsageByModel: {},
    });
    const lastUser = out.history[out.history.length - 1];
    const joined = JSON.stringify(lastUser.content);
    expect(joined).toContain('[SUBAGENT REPORT gone] — LOST');
  });
});
