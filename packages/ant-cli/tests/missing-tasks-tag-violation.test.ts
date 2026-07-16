/**
 * Verifies the `MissingTasksTagViolation` channel — the typed escalation
 * path that lets the decompose retry loop absorb a response with no complete
 * `<tasks>...</tasks>` block (prose-only drift, degenerate output, or
 * max_tokens truncation before `</tasks>`).
 *
 * Sibling of `json-syntax-violation-framing.test.ts` — same "Violation class
 * + framing builder + caller-throws-on-instanceof" shape. Regression origin:
 * `tiny-counting-mocha` (2026-07-16) — this was the ONLY decompose contract
 * failure without a typed violation, so the first bad response crashed the
 * whole job while structurally-similar failures got framed retries.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  parseLLMResponse,
  MissingTasksTagViolation,
  buildMissingTasksTagViolationFraming,
} from '../src/agents/architect/graph/code/nodes/decompose/responseParser';

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const MINIMAL_TECH_TIER =
  `<techTier>{"stack":"backend","stackReasoning":"","language":"typescript","framework":null}</techTier>`;

describe('parseLLMResponse — MissingTasksTagViolation escalation', () => {
  it('throws MissingTasksTagViolation when the response has no <tasks> block at all', () => {
    const raw = `<executionTier>2</executionTier>\n${MINIMAL_TECH_TIER}\nSome prose instead of tasks.`;

    let caught: unknown;
    try {
      parseLLMResponse(raw);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(MissingTasksTagViolation);
    const v = caught as MissingTasksTagViolation;
    expect(v.detail.hasUnclosedOpeningTag).toBe(false);
    expect(v.message).toMatch(/<tasks> tag is required/);
  });

  it('flags the truncation signature when <tasks> opened but </tasks> never arrived', () => {
    const raw =
      `<executionTier>3</executionTier>\n${MINIMAL_TECH_TIER}\n` +
      `<tasks>\n<task>{"id":"a","name":"A","type":"feature","priority":300`;

    let caught: unknown;
    try {
      parseLLMResponse(raw);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(MissingTasksTagViolation);
    const v = caught as MissingTasksTagViolation;
    expect(v.detail.hasUnclosedOpeningTag).toBe(true);
    expect(v.detail.responseTail.length).toBeLessThanOrEqual(200);
    expect(v.detail.responseTail).toContain('"priority":300');
  });

  it('does not fire when a complete <tasks> block is present (positive guard)', () => {
    const raw =
      `<executionTier>2</executionTier>\n${MINIMAL_TECH_TIER}\n` +
      `<tasks><task>{"id":"a","name":"A","type":"feature","priority":300,"packages":["shared"]}</task></tasks>`;
    expect(() => parseLLMResponse(raw)).not.toThrow();
  });
});

describe('buildMissingTasksTagViolationFraming', () => {
  it('names the truncation cause for an unclosed opening tag', () => {
    const v = new MissingTasksTagViolation('<tasks>\n<task>{"id":"a"');
    const framing = buildMissingTasksTagViolationFraming(v);
    expect(framing).toContain('## Retry: missing <tasks> block');
    expect(framing).toMatch(/never closed/);
    expect(framing).toContain('Re-emit');
  });

  it('names the absent-block cause when no <tasks> appeared', () => {
    const v = new MissingTasksTagViolation('just prose, no tags');
    const framing = buildMissingTasksTagViolationFraming(v);
    expect(framing).toContain('## Retry: missing <tasks> block');
    expect(framing).toMatch(/NO `<tasks>...<\/tasks>` block/);
  });
});

describe('decompose retry-loop wiring (static pin)', () => {
  // The retry branch lives in a node too heavy to instantiate in a unit
  // test; pin the call-site contract statically so a refactor cannot
  // silently drop the branch and regress to first-failure job crashes.
  it('decompose/index.ts branches on MissingTasksTagViolation with framing retry', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../src/agents/architect/graph/code/nodes/decompose/index.ts'),
      'utf-8',
    );
    expect(src).toContain('error instanceof MissingTasksTagViolation && attempt < MAX_ATTEMPTS');
    expect(src).toContain('buildMissingTasksTagViolationFraming(error)');
  });
});
