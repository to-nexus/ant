/**
 * Verifies the `JsonSyntaxViolation` channel — the typed escalation
 * path that lets the decompose retry loop absorb stochastic LLM JSON
 * drift instead of crashing the job.
 *
 * Sibling of `batch-split-violation-framing.test.ts` /
 * `core/executionTier/parseExecutionTierTag.test.ts`. Mirrors the same
 * "Violation class + framing builder + caller-throws-on-instanceof"
 * shape so all three retry paths share one regression surface.
 *
 * Coverage:
 *   1. `asJsonSyntaxViolation` wraps a native `SyntaxError` with
 *      position window + source label + original message.
 *   2. Non-SyntaxError inputs are wrapped (position = -1) for uniform
 *      caller handling.
 *   3. `buildJsonSyntaxViolationFraming` emits a retry framing block
 *      that names source / position / message and tells the LLM to
 *      re-emit the SAME breakdown with valid JSON.
 *   4. `parseLLMResponse` (decompose) escalates `JSON.parse` failures
 *      from <task>[i] body / legacy array body via JsonSyntaxViolation,
 *      so `decompose/index.ts` can `instanceof JsonSyntaxViolation`
 *      branch into retry. Valid bodies still pass through unchanged.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import {
  JsonSyntaxViolation,
  asJsonSyntaxViolation,
  buildJsonSyntaxViolationFraming,
} from '../src/core/utils/llmResponseParser';
import { parseLLMResponse } from '../src/agents/architect/graph/code/nodes/decompose/responseParser';

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('asJsonSyntaxViolation — native SyntaxError wrap', () => {
  it('extracts `position N` from the SyntaxError message and slices a ±100 char window', () => {
    // Production regression `JSON-syntax stack overflow` failed with the V8
    // message "Expected ',' or '}' after property value in JSON at
    // position 789" — i.e. the position-bearing syntax-error variant.
    // Reproduce that variant here (missing colon between properties)
    // with enough leading padding to prove the window slice is anchored
    // on the failing position rather than the head of the body.
    const padding = 'x'.repeat(200);
    const body = `{"name":"${padding}" "oops":1}`;
    let caught: unknown;
    try {
      JSON.parse(body);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SyntaxError);
    expect((caught as Error).message).toMatch(/at position \d+/);

    const v = asJsonSyntaxViolation(caught, body, '<task>[0] body');
    expect(v).toBeInstanceOf(JsonSyntaxViolation);
    expect(v.detail.position).toBeGreaterThan(0);
    expect(v.detail.source).toBe('<task>[0] body');
    expect(v.detail.message).toMatch(/JSON/);
    // Window is anchored on `position`, capped at body length.
    expect(v.detail.context.length).toBeLessThanOrEqual(200);
    expect(v.detail.context.length).toBeGreaterThan(0);
    // Original body must not be re-emitted in full — only the window.
    expect(v.detail.context.length).toBeLessThan(body.length);
  });

  it('falls back to head slice when V8 emits the token-style message without position', () => {
    // The other V8 variant — `Unexpected token 'X', "..." is not valid
    // JSON` — has no position marker. Caller still gets a wrapped
    // violation; head-slice context (200 chars) replaces the window.
    const body = `{"a":1,,}` + 'Y'.repeat(300);
    let caught: unknown;
    try {
      JSON.parse(body);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SyntaxError);

    const v = asJsonSyntaxViolation(caught, body, '<task>[2] body');
    if (v.detail.position === -1) {
      // Token-style message — head slice fallback.
      expect(v.detail.context).toBe(body.slice(0, 200));
    } else {
      // Some V8 builds still emit position even for token errors —
      // accept either variant, the fallback case is what matters.
      expect(v.detail.context.length).toBeLessThanOrEqual(200);
    }
    expect(v.detail.source).toBe('<task>[2] body');
  });

  it('falls back to `position = -1` and a head slice when message has no position marker', () => {
    const body = 'A'.repeat(500);
    // Hand-rolled SyntaxError without the standard "at position N" suffix.
    const err = new SyntaxError('Unexpected token');
    const v = asJsonSyntaxViolation(err, body, '<tasks> legacy array body');
    expect(v.detail.position).toBe(-1);
    // Default head slice at 200 chars.
    expect(v.detail.context).toBe(body.slice(0, 200));
    expect(v.detail.source).toBe('<tasks> legacy array body');
  });

  it('wraps non-SyntaxError inputs with position=-1 and preserves the message', () => {
    const v = asJsonSyntaxViolation(new Error('something else'), 'short body');
    expect(v).toBeInstanceOf(JsonSyntaxViolation);
    expect(v.detail.position).toBe(-1);
    expect(v.detail.message).toBe('something else');
    // No source label is OK — caller may omit it for uniform escalation.
    expect(v.detail.source).toBeUndefined();
  });

  it('handles non-Error throwables (string, number) with `String(err)` message', () => {
    const v = asJsonSyntaxViolation('boom', 'body');
    expect(v.detail.message).toBe('boom');
  });

  it('JsonSyntaxViolation extends Error with name/message wired through', () => {
    const err = new SyntaxError('Expected , at position 12');
    const v = asJsonSyntaxViolation(err, 'X'.repeat(50), '<task>[3] body');
    expect(v.name).toBe('JsonSyntaxViolation');
    // The composite Error message lets logErrorHeader / console.error read
    // the underlying syntax error without unpacking detail.
    expect(v.message).toMatch(/JsonSyntaxViolation:/);
    expect(v.message).toMatch(/Expected , at position 12/);
    expect(v.message).toMatch(/<task>\[3\] body/);
  });
});

describe('buildJsonSyntaxViolationFraming — retry prompt suffix', () => {
  function frame(opts: {
    position: number;
    context: string;
    source?: string;
    message: string;
  }): string {
    return buildJsonSyntaxViolationFraming(new JsonSyntaxViolation(opts));
  }

  it('names the source label, position, and original message', () => {
    const text = frame({
      position: 789,
      context: 'snippet around position',
      source: '<task>[3] body',
      message: "Expected ',' or '}' after property value in JSON at position 789",
    });
    expect(text).toMatch(/Retry: previous response failed JSON parsing/);
    expect(text).toMatch(/inside <task>\[3\] body/);
    expect(text).toMatch(/at position 789/);
    expect(text).toMatch(/Context around position 789/);
    expect(text).toContain('snippet around position');
  });

  it('omits the position context block when position is -1', () => {
    const text = frame({
      position: -1,
      context: 'head slice',
      source: '<tasks> legacy array body',
      message: 'Unexpected token at start',
    });
    expect(text).toMatch(/inside <tasks> legacy array body/);
    expect(text).not.toMatch(/Context around position/);
  });

  it('reminds the LLM to re-emit the SAME breakdown (not change semantics)', () => {
    const text = frame({
      position: 100,
      context: 'ctx',
      source: '<task>[0] body',
      message: 'm',
    });
    expect(text).toMatch(/Re-emit the SAME breakdown/);
    expect(text).toMatch(/<executionTier>/);
    expect(text).toMatch(/<techTier>/);
    // Common-causes block tells the LLM the typical syntax slips.
    expect(text).toMatch(/Unescaped double quote/);
    expect(text).toMatch(/Trailing comma/);
    expect(text).toMatch(/Raw newline inside a string literal/);
    expect(text).toMatch(/Missing comma between key-value pairs/);
  });

  it('framing has no <source> phrasing when source is omitted', () => {
    const text = frame({
      position: 5,
      context: 'ctx',
      message: 'msg',
    });
    expect(text).not.toMatch(/inside undefined/);
    expect(text).not.toMatch(/inside <[^>]+>/);
  });
});

describe('parseLLMResponse — JsonSyntaxViolation escalation', () => {
  // The decompose retry loop in `decompose/index.ts` branches on
  // `instanceof JsonSyntaxViolation` to retry the LLM call. Native
  // `SyntaxError` slipping through would skip the retry branch and
  // crash the job (the `JSON-syntax stack overflow` regression). These
  // assertions lock the contract at the parser boundary.
  const MINIMAL_TECH_TIER =
    `<techTier>{"stack":"backend","stackReasoning":"","language":"typescript","framework":null}</techTier>`;

  it('throws JsonSyntaxViolation when a single <task> body has invalid JSON', () => {
    const broken = '<task>{"id":"t1","name":"T1",,,}</task>';
    const raw =
      `<executionTier>3</executionTier>\n${MINIMAL_TECH_TIER}\n<tasks>${broken}</tasks>`;

    let caught: unknown;
    try {
      parseLLMResponse(raw);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(JsonSyntaxViolation);
    const v = caught as JsonSyntaxViolation;
    expect(v.detail.source).toBe('<task>[0] body');
    expect(v.detail.message).toMatch(/JSON/);
  });

  it('reports the offending task index for the second of multiple <task> wrappers', () => {
    const tasks = [
      '<task>{"id":"a","name":"A","type":"setup","priority":100,"packages":["shared"]}</task>',
      '<task>{"id":"b","name":"B with " unescaped quote","type":"feature","priority":300}</task>',
    ].join('\n');
    const raw =
      `<executionTier>3</executionTier>\n${MINIMAL_TECH_TIER}\n<tasks>\n${tasks}\n</tasks>`;

    let caught: unknown;
    try {
      parseLLMResponse(raw);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(JsonSyntaxViolation);
    expect((caught as JsonSyntaxViolation).detail.source).toBe('<task>[1] body');
  });

  it('throws JsonSyntaxViolation for invalid legacy <tasks> array body', () => {
    // Legacy contract — the body is a JSON array, not per-task wrappers.
    const broken = `[{"id":"t1","name":"T1",,}]`;
    const raw =
      `<executionTier>3</executionTier>\n${MINIMAL_TECH_TIER}\n<tasks>${broken}</tasks>`;

    let caught: unknown;
    try {
      parseLLMResponse(raw);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(JsonSyntaxViolation);
    expect((caught as JsonSyntaxViolation).detail.source).toBe('<tasks> legacy array body');
  });

  it('does NOT escalate when all <task> bodies parse cleanly (positive guard)', () => {
    const tasks = [
      '<task>{"id":"a","name":"A","type":"setup","priority":100,"packages":["shared"]}</task>',
      '<task>{"id":"b","name":"B","type":"feature","priority":300,"packages":["shared"]}</task>',
      '<task>{"id":"c","name":"C","type":"verification","priority":1000,"packages":["shared"]}</task>',
    ].join('\n');
    const raw =
      `<executionTier>3</executionTier>\n${MINIMAL_TECH_TIER}\n<tasks>\n${tasks}\n</tasks>`;

    expect(() => parseLLMResponse(raw)).not.toThrow();
    const r = parseLLMResponse(raw);
    expect(r.tasks).toHaveLength(3);
  });

  it('non-SyntaxError parser failures (e.g. missing <tasks> tag) still throw plain Error — retry branch is opt-in', () => {
    // Caller's `instanceof JsonSyntaxViolation` branch only fires for
    // the JSON.parse channel. Other parser failures (e.g. missing
    // mandatory `<tasks>` tag) must surface as native Error so the
    // retry loop fail-fasts instead of looping on a structural defect.
    const raw = `<executionTier>3</executionTier>\n${MINIMAL_TECH_TIER}\nno tasks tag here`;

    let caught: unknown;
    try {
      parseLLMResponse(raw);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(JsonSyntaxViolation);
    expect((caught as Error).message).toMatch(/<tasks> tag is required/);
  });
});
