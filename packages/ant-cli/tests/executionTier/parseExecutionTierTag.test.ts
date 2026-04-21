/**
 * parseExecutionTierTag / coerceExecutionTier — shared LLM contract
 * covering Phase B Tier Entry Nodes (code/design Decompose, plan/visual
 * Detect).
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import {
  parseExecutionTierTag,
  coerceExecutionTier,
} from '../../src/core/executionTier';
import { ExecutionTierId } from '@ant/shared';

beforeAll(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('parseExecutionTierTag', () => {
  it.each([
    ['<executionTier>0</executionTier>', ExecutionTierId.Reflex],
    ['<executionTier>1</executionTier>', ExecutionTierId.OneShot],
    ['<executionTier>2</executionTier>', ExecutionTierId.Exploratory],
    ['<executionTier>3</executionTier>', ExecutionTierId.Task],
    ['<executionTier>4</executionTier>', ExecutionTierId.RefsGrounded],
  ])('parses %s → %d', (raw, expected) => {
    expect(parseExecutionTierTag(raw)).toBe(expected);
  });

  it('tolerates whitespace / leading content', () => {
    const raw = 'Some prose...\n<executionTier>\n  3\n</executionTier>\nand more prose';
    expect(parseExecutionTierTag(raw)).toBe(ExecutionTierId.Task);
  });

  it('is case-insensitive on tag name', () => {
    expect(parseExecutionTierTag('<ExecutionTier>2</ExecutionTier>')).toBe(
      ExecutionTierId.Exploratory,
    );
  });

  it('returns undefined when tag is missing', () => {
    expect(parseExecutionTierTag('just prose')).toBeUndefined();
    expect(parseExecutionTierTag('')).toBeUndefined();
    expect(parseExecutionTierTag(undefined)).toBeUndefined();
  });

  it('returns undefined for out-of-range or non-integer tiers', () => {
    expect(parseExecutionTierTag('<executionTier>5</executionTier>')).toBeUndefined();
    expect(parseExecutionTierTag('<executionTier>-1</executionTier>')).toBeUndefined();
    expect(parseExecutionTierTag('<executionTier>2.5</executionTier>')).toBeUndefined();
    expect(parseExecutionTierTag('<executionTier>task</executionTier>')).toBeUndefined();
    expect(parseExecutionTierTag('<executionTier></executionTier>')).toBeUndefined();
  });
});

describe('coerceExecutionTier', () => {
  it('passes through a valid tier', () => {
    expect(coerceExecutionTier(ExecutionTierId.RefsGrounded, 'Test')).toBe(
      ExecutionTierId.RefsGrounded,
    );
    expect(coerceExecutionTier(ExecutionTierId.Reflex, 'Test')).toBe(
      ExecutionTierId.Reflex,
    );
  });

  it('degrades undefined to Tier 0 Reflex (hard default)', () => {
    expect(coerceExecutionTier(undefined, 'Test')).toBe(ExecutionTierId.Reflex);
  });
});
