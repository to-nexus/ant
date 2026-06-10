import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

// Regression guard for `tight-drafting-lever`: the model called the
// `<antrules-decision>` OUTPUT TAG as a (non-existent) tool, looping on
// "Unknown tool" until recursion_limit. The verify prompt must state the tag
// is NOT a callable tool, and must not list it among the callable tools.
const RULES = path.resolve(
  __dirname,
  '../../src/core/prompt/templates/jobs/code/nodes/execute/variants/verification/rules.md',
);

describe('verification rules — antrules-decision is a tag, not a tool', () => {
  const text = readFileSync(RULES, 'utf8');

  it('explicitly states antrules-decision is NOT a callable tool', () => {
    expect(text).toMatch(/not a callable tool|do NOT call it as a tool|never issue it as a tool call/i);
  });

  it('does not list antrules-decision inside the Tool Calling table', () => {
    const idx = text.indexOf('Tool Calling');
    expect(idx).toBeGreaterThan(-1);
    const toolSection = text.slice(idx);
    expect(toolSection).not.toMatch(/antrules-decision/);
  });
});
