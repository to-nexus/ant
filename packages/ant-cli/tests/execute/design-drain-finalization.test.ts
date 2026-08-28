/**
 * Drain-time forced finalization — design execute (local-caring-board RCA,
 * persistence hardened after sandy-building-dryad).
 *
 * When the recursion budget approaches the router drain threshold OR the
 * no-output streak nears the circuit breaker, execute turns run with the
 * advertised tool set narrowed (via `toolChoice: { allow: [...] }` — the
 * declarations are returned UNCHANGED; resolveToolChoice narrows at the
 * adapter) to the write tools that can succeed on the task's channel, plus
 * an "emit your final artifact now" note, so an imminent pause salvages a
 * written document instead of discarding the exploration. Contracts locked
 * here:
 *
 *   1. UNIT — `applyDrainFinalization` keeps the tools array intact, returns
 *      the allow-list constraint + appends the finalization note (string AND
 *      block-array user content), fires only below
 *      `RECURSION_DRAIN_THRESHOLD + DRAIN_FINALIZE_MARGIN` (or at
 *      no-output streak ≥ NO_OUTPUT_HARD_CAP - DRAIN_FINALIZE_MARGIN),
 *      PERSISTS while a trigger holds (sandy-building-dryad: the one-shot
 *      salvage was answered with prose, tools came back, and the model read
 *      on until the breaker fired with zero output), and no-ops without a
 *      recursionLimit or streak.
 *
 *   2. STATIC — every `return {` block of the design execute node commits
 *      `recursionCount` (the unreturned-channel-drop that starved the drain
 *      guard), so a future return path cannot silently regress it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  applyDrainFinalization,
  computeNextNoOutputCount,
} from '../../src/agents/architect/graph/design/nodes/execute/drainFinalize';
import {
  RECURSION_DRAIN_THRESHOLD,
  DRAIN_FINALIZE_MARGIN,
  NO_OUTPUT_HARD_CAP,
  routeAfterExecute,
} from '../../src/agents/architect/graph/design/routers/executeRouter';
import {
  reportMarker,
  subagentReportDeliveredThisTurn,
} from '../../src/agents/common/subagent';

const TOOLS = [{ name: 'read_file' }, { name: 'search_code' }];

function userMsg(content: string | any[]) {
  return { role: 'user', content };
}

describe('applyDrainFinalization — unit', () => {
  it('narrows toolChoice to the write tools and appends the note when the budget crosses the finalize threshold', () => {
    const messages = [userMsg('do the task')];
    const state = { recursionLimit: 100, recursionCount: 100 - (RECURSION_DRAIN_THRESHOLD + DRAIN_FINALIZE_MARGIN) + 1 };
    const { tools, toolChoice, drainFinalizing } = applyDrainFinalization(state, messages, TOOLS);

    expect(drainFinalizing).toBe(true);
    // Declarations returned UNCHANGED — deleting them while the history
    // carries tool_calls is the GLM degeneration trigger (sage-causing-rover).
    // The narrowing happens via the allow-list at resolveToolChoice.
    expect(tools).toBe(TOOLS);
    expect(toolChoice).toEqual({ allow: ['edit_file', 'append_file'] });
    // The channel value the execute node publishes for the tool node's
    // execution-side gate must be the SAME list the LLM was advertised
    // (narrow-ending-flour: advertisement-only narrowing let GLM keep reading).
    expect(applyDrainFinalization(state, [userMsg('x')], TOOLS).salvageTools)
      .toEqual(['edit_file', 'append_file']);
    const content = messages[0].content as any[];
    expect(Array.isArray(content)).toBe(true);
    expect(content[0]).toEqual({ type: 'text', text: 'do the task' });
    expect(content[1].text).toContain('Finish NOW');
    // Tool-protocol salvage note: the REVISE edit_file exit + the done signal.
    expect(content[1].text).toContain('edit_file');
    expect(content[1].text).toContain('<done>true</done>');
  });

  it('appends to block-array user content without disturbing existing blocks', () => {
    const blocks = [{ type: 'text', text: 'ctx' }, { type: 'tool_result', tool_use_id: 'x', content: 'r' }];
    const messages = [userMsg(blocks)];
    const state = { recursionLimit: 50, recursionCount: 49 };
    applyDrainFinalization(state, messages, TOOLS);

    expect(blocks).toHaveLength(3);
    expect(blocks[2]).toMatchObject({ type: 'text' });
    expect((blocks[2] as any).text).toContain('Finish NOW');
  });

  it('does not fire while ample budget remains (boundary exact)', () => {
    const atBoundary = {
      recursionLimit: 200,
      recursionCount: 200 - (RECURSION_DRAIN_THRESHOLD + DRAIN_FINALIZE_MARGIN),
    };
    const messages = [userMsg('go')];
    const { tools, drainFinalizing } = applyDrainFinalization(atBoundary, messages, TOOLS);

    expect(drainFinalizing).toBe(false);
    expect(tools).toBe(TOOLS);
    expect(messages[0].content).toBe('go');
  });

  it('persists across turns while the recursion trigger holds (not one-shot)', () => {
    // Same task, next turn: budget only tightened. The narrowing must hold —
    // returning the full tool surface after one salvage turn let the model
    // resume reading until the breaker fired with zero output
    // (sandy-building-dryad).
    for (const count of [99, 100]) {
      const messages = [userMsg('go')];
      const { tools, toolChoice, drainFinalizing } = applyDrainFinalization(
        { recursionLimit: 100, recursionCount: count },
        messages,
        TOOLS,
      );
      expect(drainFinalizing).toBe(true);
      expect(tools).toBe(TOOLS);
      expect(toolChoice).toEqual({ allow: ['edit_file', 'append_file'] });
      expect((messages[0].content as any[])[1].text).toContain('Finish NOW');
    }
  });

  it('fires on the no-output streak trigger and persists until the streak resets', () => {
    const margin = NO_OUTPUT_HARD_CAP - DRAIN_FINALIZE_MARGIN;
    // Below the margin: unconstrained.
    {
      const messages = [userMsg('go')];
      const { tools, toolChoice, drainFinalizing } = applyDrainFinalization(
        { _noOutputCallCount: margin - 1 },
        messages,
        TOOLS,
      );
      expect(drainFinalizing).toBe(false);
      expect(tools).toBe(TOOLS);
      expect(toolChoice).toBeUndefined();
    }
    // At and above the margin (every remaining pre-breaker turn): narrowed.
    for (const streak of [margin, margin + 1, NO_OUTPUT_HARD_CAP - 1]) {
      const messages = [userMsg('go')];
      const { tools, toolChoice, drainFinalizing } = applyDrainFinalization(
        { _noOutputCallCount: streak },
        messages,
        TOOLS,
      );
      expect(drainFinalizing).toBe(true);
      expect(tools).toBe(TOOLS);
      expect(toolChoice).toEqual({ allow: ['edit_file', 'append_file'] });
      expect((messages[0].content as any[])[1].text).toContain(`${streak} turns without writing`);
    }
    // A file write resets the streak channel → the constraint releases.
    {
      const messages = [userMsg('go')];
      const { tools, toolChoice, drainFinalizing } = applyDrainFinalization(
        { _noOutputCallCount: 0 },
        messages,
        TOOLS,
      );
      expect(drainFinalizing).toBe(false);
      expect(tools).toBe(TOOLS);
      expect(toolChoice).toBeUndefined();
    }
  });

  it('no-ops when recursionLimit is unset and no streak accrued (e.g. tests / legacy invokes)', () => {
    const { drainFinalizing } = applyDrainFinalization({}, [userMsg('go')], TOOLS);
    expect(drainFinalizing).toBe(false);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// targetExists dispatch — the drain exit affordance must match the task's
// actually-viable write channel. sharp-baking-bride: a generate-mode spec task
// (target not yet on disk) entered drain with edit_file surviving; edit_file
// can never succeed against a missing file, so the model looped degenerate
// failing edits to the breaker instead of writing the document. Under the
// tool-call protocol the guarantee is expressed as an allow-list: a missing
// target never allows edit_file, an existing one never allows create_file.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('applyDrainFinalization — targetExists dispatch', () => {
  const MIXED_TOOLS = [
    { name: 'read_file' },
    { name: 'search_code' },
    { name: 'edit_file' },
    { name: 'delete_file' },
  ];
  const drainState = { recursionCount: 0, recursionLimit: 0, _noOutputCallCount: NO_OUTPUT_HARD_CAP - DRAIN_FINALIZE_MARGIN };

  it('target absent → allow-list is create_file/append_file (never edit_file); note teaches create_file', () => {
    const messages = [userMsg('go')];
    const { tools, toolChoice, drainFinalizing, salvageTools } = applyDrainFinalization(
      drainState, messages, MIXED_TOOLS, { targetExists: false },
    );
    expect(drainFinalizing).toBe(true);
    expect(salvageTools).toEqual(['create_file', 'append_file']);
    // Declarations preserved; the provider-level allow-list carries the
    // narrowing (sage-causing-rover axis — deleting declarations while the
    // history carries tool_calls is the GLM degeneration trigger).
    expect(tools).toBe(MIXED_TOOLS);
    expect(toolChoice).toEqual({ allow: ['create_file', 'append_file'] });
    const note = (messages[0].content as any[])[1].text as string;
    expect(note).toContain('create_file');
    expect(note).toContain('append_file');
    expect(note).toContain('<done>true</done>');
    // A missing target must never advertise the edit exit — it errors every time.
    expect(note).not.toContain('edit_file');
  });

  it('target exists → allow-list is edit_file/append_file (never create_file); note keeps the edit_file exit', () => {
    const messages = [userMsg('go')];
    const { tools, toolChoice, drainFinalizing } = applyDrainFinalization(
      drainState, messages, MIXED_TOOLS, { targetExists: true },
    );
    expect(drainFinalizing).toBe(true);
    expect(tools).toBe(MIXED_TOOLS);
    // create_file against an existing bundle file conflicts (destructive
    // full-file regeneration on REVISE) — it is never in the exists-side list.
    expect(toolChoice).toEqual({ allow: ['edit_file', 'append_file'] });
    const note = (messages[0].content as any[])[1].text as string;
    expect(note).toContain('edit_file');
    expect(note).not.toContain('create_file');
  });

  it('omitted opts defaults to targetExists=true (edit/append allow-list — REVISE-safe)', () => {
    const messages = [userMsg('go')];
    const { tools, toolChoice } = applyDrainFinalization(drainState, messages, MIXED_TOOLS);
    expect(tools).toBe(MIXED_TOOLS);
    expect(toolChoice).toEqual({ allow: ['edit_file', 'append_file'] });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// computeNextNoOutputCount — the counter MUST climb through the persistent
// tool-strip so the router breaker (NO_OUTPUT_HARD_CAP) is reachable.
// round-grading-sable: the old increment counted only tool-call turns, so once
// the strip persisted at CAP-MARGIN the counter froze there and the breaker
// never fired → infinite prose loop. This is the design twin of the code job's
// `computeNextNoOutputStreak` `|| turn.drainFinalizing` clause.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('computeNextNoOutputCount', () => {
  it('a file write resets the streak', () => {
    expect(
      computeNextNoOutputCount(19, { hasNewFileOutput: true, hasToolCallsOnly: false, drainFinalizing: false }),
    ).toBe(0);
  });

  it('a tool-only turn increments', () => {
    expect(
      computeNextNoOutputCount(3, { hasNewFileOutput: false, hasToolCallsOnly: true, drainFinalizing: false }),
    ).toBe(4);
  });

  it('a drain-finalizing (tool-stripped, no output) turn increments — no freeze', () => {
    expect(
      computeNextNoOutputCount(20, { hasNewFileOutput: false, hasToolCallsOnly: false, drainFinalizing: true }),
    ).toBe(21);
  });

  it('climbs from the strip margin to the hard cap instead of freezing (round-grading-sable replay)', () => {
    const margin = NO_OUTPUT_HARD_CAP - DRAIN_FINALIZE_MARGIN; // 20
    let streak = margin;
    // Every turn from the margin on is tool-stripped (drainFinalizing) prose —
    // no file, no tool calls. The counter must reach the cap in <= MARGIN turns.
    for (let i = 0; i < DRAIN_FINALIZE_MARGIN + 2 && streak < NO_OUTPUT_HARD_CAP; i++) {
      streak = computeNextNoOutputCount(streak, {
        hasNewFileOutput: false,
        hasToolCallsOnly: false,
        drainFinalizing: true,
      });
    }
    expect(streak).toBeGreaterThanOrEqual(NO_OUTPUT_HARD_CAP);
  });

  // Subagent fairness (small-longing-drive): the clock detects a STUCK model,
  // not infra latency — waiting on commissioned explores freezes it, and a
  // delivered report restarts it like a file write does.
  it('a turn spent while commissioned explores are pending freezes the streak (no +1, no reset)', () => {
    expect(
      computeNextNoOutputCount(19, {
        hasNewFileOutput: false, hasToolCallsOnly: true, drainFinalizing: false, subagentsPending: true,
      }),
    ).toBe(19);
  });

  it('a delivered subagent report resets the streak like a file write', () => {
    expect(
      computeNextNoOutputCount(24, {
        hasNewFileOutput: false, hasToolCallsOnly: false, drainFinalizing: true, subagentReportDelivered: true,
      }),
    ).toBe(0);
  });

  it('delivery reset wins over a residual pending sibling (staggered explore arrivals)', () => {
    expect(
      computeNextNoOutputCount(22, {
        hasNewFileOutput: false, hasToolCallsOnly: true, drainFinalizing: true,
        subagentReportDelivered: true, subagentsPending: true,
      }),
    ).toBe(0);
  });

  it('a file write still wins over everything', () => {
    expect(
      computeNextNoOutputCount(22, {
        hasNewFileOutput: true, hasToolCallsOnly: false, drainFinalizing: true, subagentsPending: true,
      }),
    ).toBe(0);
  });
});

describe('subagentReportDeliveredThisTurn — delivery-turn predicate', () => {
  it('detects a report marker in the LAST user message (string and block content)', () => {
    expect(subagentReportDeliveredThisTurn([
      userMsg('do the task'),
      { role: 'assistant', content: 'reading' },
      userMsg(`${reportMarker('abc123')} (goal: x)\nfindings`),
    ] as any)).toBe(true);
    expect(subagentReportDeliveredThisTurn([
      userMsg([{ type: 'tool_result', content: 'ok' }, { type: 'text', text: `${reportMarker('abc123')} body` }]),
    ] as any)).toBe(true);
  });

  it('a report older than the last user message does NOT count (delivery turn only)', () => {
    expect(subagentReportDeliveredThisTurn([
      userMsg(`${reportMarker('abc123')} body`),
      { role: 'assistant', content: 'digesting' },
      userMsg('tool results without any report'),
    ] as any)).toBe(false);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Breaker escapes (small-longing-drive): the router must not guillotine a
// pending salvage write, and a zero-output task gets exactly one re-ask
// turn before design_no_output discards the run.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('routeAfterExecute — no-output breaker escapes', () => {
  const atCap = (over: Record<string, unknown>) => ({
    _noOutputCallCount: NO_OUTPUT_HARD_CAP,
    _executeCallIndex: 30,
    llmResponse: { textResponse: 'let me write now', done: false },
    ...over,
  }) as any;

  it('a pending write tool call at the cap routes to tool (the salvage write must execute)', () => {
    expect(routeAfterExecute(atCap({
      llmResponse: { toolCalls: [{ name: 'create_file', arguments: {} }], done: false },
      _breakerReAsked: true,
    }))).toBe('tool');
  });

  it('zero output + unspent grant routes back to execute for the one-shot final turn', () => {
    expect(routeAfterExecute(atCap({ _taskFilesWritten: 0 }))).toBe('execute');
  });

  it('grant already spent → checkTaskStatus (the breaker stays terminal)', () => {
    expect(routeAfterExecute(atCap({ _taskFilesWritten: 0, _breakerReAsked: true }))).toBe('checkTaskStatus');
  });

  it('a non-write tool call at the cap with the grant spent is discarded → checkTaskStatus', () => {
    expect(routeAfterExecute(atCap({
      llmResponse: { toolCalls: [{ name: 'read_file', arguments: {} }], done: false },
      _taskFilesWritten: 0,
      _breakerReAsked: true,
    }))).toBe('checkTaskStatus');
  });

  it('task already produced files → breaker diverts as before (no grant needed)', () => {
    expect(routeAfterExecute(atCap({ _taskFilesWritten: 2 }))).toBe('checkTaskStatus');
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STATIC — per-return-path commit lock on the design execute node.
// Extractor mirrors tests/execute/execute-active-phase.test.ts.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('design execute node — every return commits recursionCount', () => {
  const source = readFileSync(
    resolve(__dirname, '../../src/agents/architect/graph/design/nodes/execute/index.ts'),
    'utf-8',
  );

  const returnBlocks = (() => {
    const blocks: string[] = [];
    let inBlock = false;
    let braceDepth = 0;
    let buffer: string[] = [];
    for (const line of source.split('\n')) {
      if (!inBlock) {
        if (/^\s*return\s*\{\s*$/.test(line)) {
          inBlock = true;
          braceDepth = 1;
          buffer = [line];
        }
        continue;
      }
      buffer.push(line);
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

  it('finds the known return blocks', () => {
    expect(returnBlocks.length).toBeGreaterThanOrEqual(2);
  });

  it.each([['recursionCount:'], ['_drainSalvageTools:']])('every return block contains %s', (field) => {
    for (const [i, block] of returnBlocks.entries()) {
      expect(
        block.includes(field),
        `design execute return block #${i + 1} missing \`${field}\` — ` +
          `an unreturned last-value channel is dropped at the node transition ` +
          `(drain-guard starvation, local-caring-board RCA)\n${block.slice(0, 300)}`,
      ).toBe(true);
    }
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// gateDrainSalvage — execution-side enforcement of the drain allow-list.
// narrow-ending-flour RCA: `toolChoice { allow }` only narrows the ADVERTISED
// declarations; GLM (OpenAI-compat, cloud) kept emitting undeclared read_file
// calls through every salvage round, and the tool executor — which dispatches
// any registered tool by name — executed them and returned fresh reads,
// rewarding the violation until the breaker discarded the run. The gate makes
// the narrowing binding at the seam that actually runs tools.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('gateDrainSalvage — execution-side enforcement', () => {
  it.each([
    // [salvageTools, callName, allowed]
    [null, 'read_file', true],                                    // not draining
    [undefined, 'read_file', true],                               // channel unset
    [[], 'read_file', true],                                      // degenerate empty = inactive
    [['create_file', 'append_file'], 'create_file', true],        // salvage write allowed
    [['create_file', 'append_file'], 'append_file', true],
    [['create_file', 'append_file'], 'read_file', false],         // undeclared read refused
    [['create_file', 'append_file'], 'search_code', false],
    [['edit_file', 'append_file'], 'create_file', false],         // REVISE side refuses create
  ] as Array<[string[] | null | undefined, string, boolean]>)(
    'salvage=%j call=%s → allowed=%s',
    async (salvageTools, callName, allowed) => {
      const { gateDrainSalvage } = await import('../../src/agents/common/tool/drainSalvageGate');
      const verdict = gateDrainSalvage(salvageTools, { name: callName });
      expect(verdict.allowed).toBe(allowed);
      if (!verdict.allowed) {
        // Instructive refusal: names the surviving write channel and the exit
        // signal so the refusal funnels the model into writing.
        expect(verdict.error).toContain(callName);
        for (const t of salvageTools!) expect(verdict.error).toContain(t);
        expect(verdict.error).toContain('<done>true</done>');
      }
    },
  );

  it('both tool nodes bind the gate (design gateCall + code gateCall drain-first composition)', () => {
    const designToolSrc = readFileSync(
      resolve(__dirname, '../../src/agents/architect/graph/design/nodes/tool/index.ts'),
      'utf-8',
    );
    const codeToolSrc = readFileSync(
      resolve(__dirname, '../../src/agents/architect/graph/code/nodes/tool/index.ts'),
      'utf-8',
    );
    expect(designToolSrc).toContain('gateDrainSalvage(state._drainSalvageTools');
    expect(codeToolSrc).toContain('gateDrainSalvage(state._drainSalvageTools');
    // Composition order: the drain refusal must be judged BEFORE the RAC
    // read-scope gate — a drained round's read is refused as "write now",
    // not admitted/denied on RAC grounds.
    expect(codeToolSrc.indexOf('gateDrainSalvage(state._drainSalvageTools'))
      .toBeLessThan(codeToolSrc.indexOf('computeRacScope(state.resolvedAction)'));
  });
});
