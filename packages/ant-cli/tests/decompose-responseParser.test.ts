import { describe, it, expect, vi, beforeAll } from 'vitest';
import { parseLLMResponse } from '../src/agents/architect/graph/code/nodes/decompose/responseParser';

/**
 * Regression coverage for the 5-tier execution model tag parser.
 *
 * Scope:
 *   - <executionTier> tag parsing (0..4)
 *   - heuristic provenance when tag is missing / invalid
 *   - <executionTierReasoning> extraction
 *   - directHints JSON (targetFiles + explorationScope)
 *   - specClarify JSON validation (all required fields must be present)
 */

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const MINIMAL_TECH_TIER = `<techTier>{"stack":"backend","stackReasoning":"","language":"typescript","framework":null}</techTier>`;
const MINIMAL_TASKS = `<tasks>[]</tasks>`;

const makeResponse = (extra: string): string =>
  `${extra}\n${MINIMAL_TECH_TIER}\n${MINIMAL_TASKS}`;

describe('parseLLMResponse — executionTier classification', () => {
  it.each([0, 1, 2, 3, 4])('parses <executionTier>%d</executionTier>', (tier) => {
    const r = parseLLMResponse(makeResponse(`<executionTier>${tier}</executionTier>`));
    expect(r.executionTier).toBe(tier);
  });

  it('returns undefined when tag is absent (caller applies fallback)', () => {
    const r = parseLLMResponse(makeResponse(''));
    expect(r.executionTier).toBeUndefined();
  });

  it('returns undefined on non-integer values', () => {
    const r = parseLLMResponse(makeResponse('<executionTier>task</executionTier>'));
    expect(r.executionTier).toBeUndefined();
  });

  it('returns undefined on out-of-range values', () => {
    const r = parseLLMResponse(makeResponse('<executionTier>7</executionTier>'));
    expect(r.executionTier).toBeUndefined();
  });

  it('trims whitespace around the integer', () => {
    const r = parseLLMResponse(makeResponse('<executionTier>  3  </executionTier>'));
    expect(r.executionTier).toBe(3);
  });
});

describe('parseLLMResponse — directHints', () => {
  it('parses targetFiles', () => {
    const r = parseLLMResponse(
      makeResponse(
        '<executionTier>1</executionTier><directHints>{"targetFiles":["src/a.ts","src/b.ts"]}</directHints>',
      ),
    );
    expect(r.directHints?.targetFiles).toEqual(['src/a.ts', 'src/b.ts']);
    expect(r.directHints?.explorationScope).toBeUndefined();
  });

  it('parses explorationScope', () => {
    const r = parseLLMResponse(
      makeResponse(
        '<executionTier>2</executionTier><directHints>{"explorationScope":"auth middleware"}</directHints>',
      ),
    );
    expect(r.directHints?.explorationScope).toBe('auth middleware');
    expect(r.directHints?.targetFiles).toBeUndefined();
  });

  it('returns undefined when directHints body is the empty object', () => {
    const r = parseLLMResponse(
      makeResponse(
        '<executionTier>3</executionTier><directHints>{}</directHints>',
      ),
    );
    expect(r.directHints).toBeUndefined();
  });

  it('returns undefined when directHints tag is absent', () => {
    const r = parseLLMResponse(makeResponse('<executionTier>3</executionTier>'));
    expect(r.directHints).toBeUndefined();
  });

  it('drops non-string entries from targetFiles', () => {
    const r = parseLLMResponse(
      makeResponse(
        '<executionTier>1</executionTier><directHints>{"targetFiles":["src/a.ts",null,42,""]}</directHints>',
      ),
    );
    expect(r.directHints?.targetFiles).toEqual(['src/a.ts']);
  });

  it('ignores malformed JSON without throwing', () => {
    const r = parseLLMResponse(
      makeResponse(
        '<executionTier>1</executionTier><directHints>{not-json}</directHints>',
      ),
    );
    expect(r.directHints).toBeUndefined();
  });
});

describe('parseLLMResponse — specClarify', () => {
  const FULL_SPEC_CLARIFY = `<specClarify>{
  "needsChoice": true,
  "reason": "No design document or directive-relevant spec available.",
  "displayMessage": "This work needs a spec first.",
  "choiceOptions": {
    "positive": { "label": "Design first", "action": "redirect_to_design" },
    "neutral":  { "label": "Proceed anyway", "action": "proceed_without_spec" },
    "negative": { "label": "Cancel", "action": "cancel" }
  }
}</specClarify>`;

  it('parses a well-formed specClarify payload', () => {
    const r = parseLLMResponse(
      makeResponse(`<executionTier>3</executionTier>\n${FULL_SPEC_CLARIFY}`),
    );
    expect(r.specClarify?.needsChoice).toBe(true);
    expect(r.specClarify?.choiceOptions.positive.action).toBe('redirect_to_design');
    expect(r.specClarify?.choiceOptions.neutral.action).toBe('proceed_without_spec');
    expect(r.specClarify?.choiceOptions.negative.action).toBe('cancel');
  });

  it('ignores specClarify when needsChoice is not exactly true', () => {
    const bad = `<specClarify>{
      "needsChoice": "yes",
      "reason": "r", "displayMessage": "m",
      "choiceOptions": {
        "positive": {"label":"p","action":"redirect_to_design"},
        "neutral":  {"label":"n","action":"proceed_without_spec"},
        "negative": {"label":"c","action":"cancel"}
      }
    }</specClarify>`;
    const r = parseLLMResponse(makeResponse(`<executionTier>3</executionTier>\n${bad}`));
    expect(r.specClarify).toBeUndefined();
  });

  it('ignores specClarify when any required choice action is missing', () => {
    const bad = `<specClarify>{
      "needsChoice": true,
      "reason": "r", "displayMessage": "m",
      "choiceOptions": {
        "positive": {"label":"p","action":"redirect_to_design"},
        "neutral":  {"label":"n"},
        "negative": {"label":"c","action":"cancel"}
      }
    }</specClarify>`;
    const r = parseLLMResponse(makeResponse(`<executionTier>3</executionTier>\n${bad}`));
    expect(r.specClarify).toBeUndefined();
  });

  it('returns undefined when specClarify tag is absent', () => {
    const r = parseLLMResponse(makeResponse('<executionTier>3</executionTier>'));
    expect(r.specClarify).toBeUndefined();
  });
});
