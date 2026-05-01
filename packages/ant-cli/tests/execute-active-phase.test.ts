/**
 * L1 — `_activePhase` leak guard (verification 400 regression).
 *
 * Regression: job `wild-flying-scout` (2026-04-30). The verification
 * task's last cycle entered Anthropic with `messages.2` containing a
 * `tool_use` whose `tool_result` never arrived in the next message:
 *
 *     400 invalid_request_error
 *     messages.2: `tool_use` ids were found without `tool_result` blocks
 *     immediately after: toolu_012mzskktZj1xhbeRNSepFjh.
 *
 * Root cause was a phase asymmetry. `plan` declared `_activePhase`
 * on every return; `execute` declared it on none. When a `plan-toolLoop`
 * turn left `_activePhase: 'plan'` in the LangGraph state and the graph
 * fell through to `execute` (via `maybeResumeInterrupted` short-circuit
 * + `planRouter` fallthrough), the next `tool` node read its history
 * from `NODE_PLAN` and committed the `tool_result` to `NODE_PLAN`
 * instead of `NODE_EXECUTE` — leaving the `tool_use` orphaned in
 * `NODE_EXECUTE` and producing the 400 above on the next execute call.
 *
 * The fix declares `_activePhase: 'execute' as const` on every `execute`
 * return and on the `maybeResumeInterrupted` short-circuit. This suite
 * locks both contracts:
 *
 *   1. STATIC — every `return {` block in `nodes/execute/index.ts` and
 *      the resume short-circuit in `nodes/plan/index.ts` carries the
 *      phase declaration so the contract cannot silently regress when
 *      a future return path is added.
 *
 *   2. DYNAMIC — the `tool` node's `getHistory`/`buildReturn` slot
 *      branching, which keys off `_activePhase`, writes `tool_result`
 *      blocks into `NODE_EXECUTE` (not `NODE_PLAN`) once execute has
 *      declared its phase. The leaked `'plan'` scenario writes to
 *      `NODE_PLAN`, demonstrating that the static phase tag is the
 *      decisive bit.
 *
 *   3. INTEGRATION — `routeAfterTool` keys off the same field; the
 *      cleared phase routes back to `execute` instead of bouncing into
 *      `plan` and feeding the `maybeResumeInterrupted` loop again.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { routeAfterTool } from '../src/agents/architect/graph/code/routers/toolRouter';
import { createToolNode } from '../src/agents/common/tool/createToolNode';
import type {
  ToolRegistry,
  ToolExecutionContext,
  ToolResult,
} from '../src/agents/common/tool/types';
import type { ArchitectGraphState } from '../src/agents/architect/graph/code/state';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. STATIC — every return path declares `_activePhase: 'execute'`
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('execute node — `_activePhase: \'execute\'` declared on every return', () => {
  const executePath = resolve(
    __dirname,
    '../src/agents/architect/graph/code/nodes/execute/index.ts',
  );
  const source = readFileSync(executePath, 'utf-8');

  // A return block ends at the matching `};` line. Stripping nested
  // closures via balanced-brace counting is overkill — the file's
  // returns are always object literals, never functions, so a regex
  // that captures `return {` through the next standalone `};` is fine.
  const returnBlocks = (() => {
    const blocks: string[] = [];
    const lines = source.split('\n');
    let inBlock = false;
    let braceDepth = 0;
    let buffer: string[] = [];
    for (const line of lines) {
      if (!inBlock) {
        if (/^\s*return\s*\{\s*$/.test(line)) {
          inBlock = true;
          braceDepth = 1;
          buffer = [line];
        }
        continue;
      }
      buffer.push(line);
      // Cheap depth tracker — `{`/`}` outside strings is the dominant
      // case in this file and matches our needs (we are validating
      // presence of a literal field, not parsing arbitrary code).
      for (const ch of line) {
        if (ch === '{') braceDepth++;
        else if (ch === '}') braceDepth--;
      }
      if (braceDepth === 0) {
        blocks.push(buffer.join('\n'));
        inBlock = false;
        buffer = [];
      }
    }
    return blocks;
  })();

  it('finds the three known return blocks (matches grep results)', () => {
    expect(returnBlocks.length).toBe(3);
  });

  it('every return block declares `_activePhase: \'execute\' as const`', () => {
    for (const [i, block] of returnBlocks.entries()) {
      expect(
        block,
        `execute return block #${i + 1} missing `
          + `\`_activePhase: 'execute' as const\` declaration — phase leak guard`,
      ).toMatch(/_activePhase:\s*'execute'\s+as\s+const/);
    }
  });
});

describe('maybeResumeInterrupted — resume short-circuit declares phase', () => {
  const planPath = resolve(
    __dirname,
    '../src/agents/architect/graph/code/nodes/plan/shortcut/resumeInterrupted.ts',
  );
  const source = readFileSync(planPath, 'utf-8');

  // Slice the `maybeResumeInterrupted` function body. The function is
  // bounded by the `async function maybeResumeInterrupted(` header and
  // the closing `}` at column 0 that ends the function declaration.
  const fnSource = (() => {
    const start = source.indexOf('async function maybeResumeInterrupted(');
    expect(start, 'maybeResumeInterrupted not found in plan/index.ts').toBeGreaterThan(-1);
    // Find the next top-level `^}` after `start`.
    const after = source.slice(start);
    const lines = after.split('\n');
    let depth = 0;
    let seenOpen = false;
    let endIdx = 0;
    for (const [i, line] of lines.entries()) {
      for (const ch of line) {
        if (ch === '{') { depth++; seenOpen = true; }
        else if (ch === '}') depth--;
      }
      if (seenOpen && depth === 0) { endIdx = i; break; }
    }
    return lines.slice(0, endIdx + 1).join('\n');
  })();

  it('declares `_activePhase: \'execute\' as const` in the resume return', () => {
    expect(fnSource).toMatch(/_activePhase:\s*'execute'\s+as\s+const/);
  });

  it('clears `llmResponse.toolCalls` so planRouter cannot pick up stale tool_use', () => {
    expect(fnSource).toMatch(/llmResponse:\s*\{[^}]*toolCalls:\s*\[\s*\]/s);
    expect(fnSource).toMatch(/llmResponse:\s*\{[^}]*done:\s*false/s);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. DYNAMIC — `tool` node honours the phase tag for slot routing
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type ToolState = {
  _activePhase?: 'plan' | 'execute';
  llmResponse?: { toolCalls: unknown[] };
  conversations: Record<string, any[]>;
};

function makeRegistry(result: ToolResult): ToolRegistry {
  return {
    get(_name: string) {
      return async (_ctx: ToolExecutionContext, _args: any): Promise<ToolResult> => result;
    },
    has() { return true; },
    list() { return ['fake_tool']; },
  } as unknown as ToolRegistry;
}

function buildPhaseAwareToolNode() {
  return createToolNode<ToolState>({
    getPendingCalls(state) {
      return (state.llmResponse?.toolCalls ?? []) as any;
    },
    buildContext(_state): ToolExecutionContext {
      return {
        chatStatus: {
          showStatus: async () => {},
          showProgress: async () => {},
          showFigmaImage: async () => {},
          completeFileCreation: () => {},
          completeFileEdit: () => {},
          completeFileDeletion: () => {},
        },
      } as unknown as ToolExecutionContext;
    },
    registry: makeRegistry({ content: 'ok' }),
    getHistory(state) {
      return state._activePhase === 'plan'
        ? (state.conversations['node:plan'] ?? [])
        : (state.conversations['node:execute'] ?? []);
    },
    buildReturn(state, { updatedHistory }) {
      if (state._activePhase === 'plan') {
        return { conversations: { 'node:plan': updatedHistory } } as Partial<ToolState>;
      }
      return { conversations: { 'node:execute': updatedHistory } } as Partial<ToolState>;
    },
  });
}

describe('tool node — `_activePhase` decides which conversation slot receives `tool_result`', () => {
  it('writes `tool_result` to NODE_EXECUTE when phase is "execute" (post-fix scenario)', async () => {
    const node = buildPhaseAwareToolNode();
    const out = await node({
      _activePhase: 'execute',
      llmResponse: { toolCalls: [{ id: 'tu_1', name: 'fake_tool', args: {} }] },
      conversations: { 'node:execute': [], 'node:plan': [] },
    });
    const conv = (out.conversations as Record<string, any[]>) ?? {};
    expect(conv['node:execute']?.length ?? 0).toBe(1);
    expect(conv['node:plan']).toBeUndefined();
    const userTurn = conv['node:execute'][0];
    expect(userTurn.role).toBe('user');
    const block = (userTurn.content as any[])[0];
    expect(block.type).toBe('tool_result');
    expect(block.tool_use_id).toBe('tu_1');
  });

  it('writes `tool_result` to NODE_PLAN when phase leaks as "plan" (pre-fix bug scenario)', async () => {
    const node = buildPhaseAwareToolNode();
    const out = await node({
      _activePhase: 'plan',
      llmResponse: { toolCalls: [{ id: 'tu_1', name: 'fake_tool', args: {} }] },
      conversations: { 'node:execute': [], 'node:plan': [] },
    });
    const conv = (out.conversations as Record<string, any[]>) ?? {};
    expect(conv['node:plan']?.length ?? 0).toBe(1);
    expect(conv['node:execute']).toBeUndefined();
    // Demonstrates the bug: an execute-issued `tool_use` would land
    // its `tool_result` in NODE_PLAN, leaving NODE_EXECUTE's
    // assistant(tool_use) orphaned. The static guard above ensures
    // execute always tags `'execute'`, so this branch is no longer
    // reachable from the production graph.
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. INTEGRATION — `routeAfterTool` honours the cleared phase tag
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('routeAfterTool — phase tag drives post-tool routing', () => {
  it('routes back to `execute` when execute correctly tagged the phase', () => {
    const state = Object.freeze({
      _activePhase: 'execute',
    }) as unknown as ArchitectGraphState;
    expect(routeAfterTool(state)).toBe('execute');
  });

  it('routes to `plan` when phase was leaked as "plan" (pre-fix bug)', () => {
    const state = Object.freeze({
      _activePhase: 'plan',
    }) as unknown as ArchitectGraphState;
    expect(routeAfterTool(state)).toBe('plan');
  });
});
