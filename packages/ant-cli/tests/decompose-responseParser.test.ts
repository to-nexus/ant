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

  it('recovers specClarify body wrapped in a ```json markdown fence', () => {
    // Regression: observed LLM violation of "NO ``` markers" in the decompose
    // prompt (tag `late-fading-cross`). A fenced body caused JSON.parse to
    // fail on the leading backtick and silently dropped the payload, which
    // collapsed the job into a 0-task no-op success.
    const fenced = [
      '<specClarify>',
      '```json',
      '{',
      '  "needsChoice": true,',
      '  "reason": "No design or spec.",',
      '  "displayMessage": "Need a spec first.",',
      '  "choiceOptions": {',
      '    "positive": { "label": "Design first", "action": "redirect_to_design" },',
      '    "neutral":  { "label": "Proceed",      "action": "proceed_without_spec" },',
      '    "negative": { "label": "Cancel",       "action": "cancel" }',
      '  }',
      '}',
      '```',
      '</specClarify>',
    ].join('\n');
    const r = parseLLMResponse(makeResponse(`<executionTier>3</executionTier>\n${fenced}`));
    expect(r.specClarify?.needsChoice).toBe(true);
    expect(r.specClarify?.choiceOptions.positive.action).toBe('redirect_to_design');
  });

  it('recovers specClarify body wrapped in a bare ``` fence (no lang)', () => {
    const fenced = [
      '<specClarify>',
      '```',
      '{"needsChoice":true,"reason":"r","displayMessage":"m",',
      ' "choiceOptions":{',
      '   "positive":{"label":"p","action":"redirect_to_design"},',
      '   "neutral":{"label":"n","action":"proceed_without_spec"},',
      '   "negative":{"label":"c","action":"cancel"}}}',
      '```',
      '</specClarify>',
    ].join('\n');
    const r = parseLLMResponse(makeResponse(`<executionTier>3</executionTier>\n${fenced}`));
    expect(r.specClarify?.needsChoice).toBe(true);
  });
});

describe('parseLLMResponse — code fence tolerance across tags', () => {
  // Triple-backtick fences are forbidden by the prompt but the LLM
  // violates this occasionally. Every JSON-bearing tag must survive.
  it('strips a ```json fence around <tasks>', () => {
    const body = '```json\n[{"id":"t1","name":"T1","type":"feature","priority":300,"packages":["shared"]}]\n```';
    const r = parseLLMResponse(
      `<executionTier>3</executionTier>\n${MINIMAL_TECH_TIER}\n<tasks>${body}</tasks>`,
    );
    expect(r.tasks).toHaveLength(1);
    expect(r.tasks[0].id).toBe('t1');
  });

  it('strips a ```json fence around <techTier>', () => {
    const body = '```json\n{"stack":"backend","stackReasoning":"","language":"typescript","framework":null}\n```';
    const r = parseLLMResponse(
      `<executionTier>3</executionTier>\n<techTier>${body}</techTier>\n${MINIMAL_TASKS}`,
    );
    expect(r.techTier?.stack).toBe('backend');
  });

  it('strips a ```json fence around <directHints>', () => {
    const body = '```json\n{"targetFiles":["src/a.ts"]}\n```';
    const r = parseLLMResponse(
      makeResponse(`<executionTier>1</executionTier><directHints>${body}</directHints>`),
    );
    expect(r.directHints?.targetFiles).toEqual(['src/a.ts']);
  });
});
