/**
 * Unit tests for the shared `<plan>` text extractor.
 */

import { describe, it, expect } from 'vitest';
import { extractPlanText } from '../../../../../../src/agents/common/graph/nodes/plan';

describe('extractPlanText', () => {
  it('returns trimmed inner text when the block is well-formed and long enough', () => {
    const body = JSON.stringify({
      task: { id: 't', goal: 'Plan something concrete with enough chars' },
      explorationSummary: 'Looked at relevant modules',
      candidateSolutions: [
        { name: 'A', approach: 'foo', pros: [], cons: [], risk: 'low' },
        { name: 'B', approach: 'bar', pros: [], cons: [], risk: 'low' },
      ],
      decision: { selected: 'A', rationale: 'A is simpler' },
      documentOutline: [{ section: 'Overview', content: '...' }],
    });
    const text = `Some thinking text\n<plan>${body}</plan>\nAnd then trailing prose.`;
    const out = extractPlanText(text);
    expect(out).toBe(body);
  });

  it('returns null when no <plan> block is present', () => {
    expect(extractPlanText('plain text without any plan tag')).toBeNull();
  });

  it('returns null when the <plan> block body is shorter than the minimum length', () => {
    expect(extractPlanText('<plan>tiny</plan>', 50)).toBeNull();
  });

  it('respects a custom minimum length', () => {
    expect(extractPlanText('<plan>123456789</plan>', 5)).toBe('123456789');
    expect(extractPlanText('<plan>123456789</plan>', 20)).toBeNull();
  });

  it('returns the FIRST plan block when multiple are present (defensive against runaway emission)', () => {
    const padded = 'A'.repeat(60);
    const text = `<plan>${padded}</plan>\n<plan>second-block-content-also-padded-${padded}</plan>`;
    expect(extractPlanText(text)).toBe(padded);
  });
});
