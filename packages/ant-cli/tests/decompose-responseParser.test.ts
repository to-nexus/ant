import { describe, it, expect, vi, beforeAll } from 'vitest';
import { parseLLMResponse } from '../src/agents/architect/graph/code/nodes/decompose/responseParser';

/**
 * Regression coverage for the 5-tier execution model tag parser.
 *
 * Scope (per session-redesign-handoff §3.5):
 *   - complexity matrix: oneshot / exploratory / todo
 *   - safe default when tag missing or invalid
 *   - complexityReason extraction
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

const makeResponse = (extra: string): string => `${extra}\n${MINIMAL_TECH_TIER}\n${MINIMAL_TASKS}`;

describe('parseLLMResponse — complexity classification', () => {
  it('parses <complexity>oneshot</complexity>', () => {
    const r = parseLLMResponse(makeResponse('<complexity>oneshot</complexity>'));
    expect(r.complexity).toBe('oneshot');
  });

  it('parses <complexity>exploratory</complexity>', () => {
    const r = parseLLMResponse(makeResponse('<complexity>exploratory</complexity>'));
    expect(r.complexity).toBe('exploratory');
  });

  it('parses <complexity>task</complexity>', () => {
    const r = parseLLMResponse(makeResponse('<complexity>task</complexity>'));
    expect(r.complexity).toBe('task');
  });

  it('accepts legacy <complexity>todo</complexity> as alias of "task"', () => {
    // Pre-5-tier-rename literal stays accepted so cached LLM outputs /
    // older prompt revisions keep parsing. Normalization is documented
    // on `normalizeComplexity` in responseParser.ts.
    const r = parseLLMResponse(makeResponse('<complexity>todo</complexity>'));
    expect(r.complexity).toBe('task');
  });

  it('defaults to "task" when tag is absent', () => {
    const r = parseLLMResponse(makeResponse(''));
    expect(r.complexity).toBe('task');
  });

  it('defaults to "task" on unknown values (safe narrowing)', () => {
    const r = parseLLMResponse(makeResponse('<complexity>megafeature</complexity>'));
    expect(r.complexity).toBe('task');
  });

  it('is case-insensitive and trims whitespace', () => {
    const r = parseLLMResponse(makeResponse('<complexity>  ONESHOT  </complexity>'));
    expect(r.complexity).toBe('oneshot');
  });
});

describe('parseLLMResponse — complexityDecidedBy', () => {
  it('reports decidedBy="llm" when <complexity> tag is present', () => {
    const r = parseLLMResponse(makeResponse('<complexity>oneshot</complexity>'));
    expect(r.complexityDecidedBy).toBe('llm');
  });

  it('reports decidedBy="llm" even for unknown tag values (LLM emitted *something*)', () => {
    const r = parseLLMResponse(makeResponse('<complexity>megafeature</complexity>'));
    expect(r.complexityDecidedBy).toBe('llm');
    expect(r.complexity).toBe('task'); // normalised fallback
  });

  it('reports decidedBy="heuristic" when the tag is absent (fallback default)', () => {
    const r = parseLLMResponse(makeResponse(''));
    expect(r.complexityDecidedBy).toBe('heuristic');
    expect(r.complexity).toBe('task');
  });
});

describe('parseLLMResponse — complexityReason', () => {
  it('extracts complexityReason when present', () => {
    const r = parseLLMResponse(
      makeResponse(
        '<complexity>oneshot</complexity><complexityReason>Single rename against a known file.</complexityReason>'
      )
    );
    expect(r.complexityReason).toBe('Single rename against a known file.');
  });

  it('returns undefined when complexityReason is empty/whitespace', () => {
    const r = parseLLMResponse(
      makeResponse('<complexity>oneshot</complexity><complexityReason>   </complexityReason>')
    );
    expect(r.complexityReason).toBeUndefined();
  });

  it('returns undefined when complexityReason tag is absent', () => {
    const r = parseLLMResponse(makeResponse('<complexity>oneshot</complexity>'));
    expect(r.complexityReason).toBeUndefined();
  });
});

describe('parseLLMResponse — directHints', () => {
  it('parses targetFiles for oneshot hint shape', () => {
    const r = parseLLMResponse(
      makeResponse(
        '<complexity>oneshot</complexity><directHints>{"targetFiles":["src/a.ts","src/b.ts"]}</directHints>'
      )
    );
    expect(r.directHints?.targetFiles).toEqual(['src/a.ts', 'src/b.ts']);
    expect(r.directHints?.explorationScope).toBeUndefined();
  });

  it('parses explorationScope for exploratory hint shape', () => {
    const r = parseLLMResponse(
      makeResponse(
        '<complexity>exploratory</complexity><directHints>{"explorationScope":"auth middleware"}</directHints>'
      )
    );
    expect(r.directHints?.explorationScope).toBe('auth middleware');
    expect(r.directHints?.targetFiles).toBeUndefined();
  });

  it('returns undefined when directHints body is the empty object', () => {
    const r = parseLLMResponse(
      makeResponse('<complexity>todo</complexity><directHints>{}</directHints>')
    );
    expect(r.directHints).toBeUndefined();
  });

  it('returns undefined when directHints tag is absent', () => {
    const r = parseLLMResponse(makeResponse('<complexity>todo</complexity>'));
    expect(r.directHints).toBeUndefined();
  });

  it('drops non-string entries from targetFiles', () => {
    const r = parseLLMResponse(
      makeResponse(
        '<complexity>oneshot</complexity><directHints>{"targetFiles":["src/a.ts",null,42,""]}</directHints>'
      )
    );
    expect(r.directHints?.targetFiles).toEqual(['src/a.ts']);
  });

  it('ignores malformed JSON without throwing', () => {
    const r = parseLLMResponse(
      makeResponse('<complexity>oneshot</complexity><directHints>{not-json}</directHints>')
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
    const r = parseLLMResponse(makeResponse(`<complexity>todo</complexity>\n${FULL_SPEC_CLARIFY}`));
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
    const r = parseLLMResponse(makeResponse(`<complexity>todo</complexity>\n${bad}`));
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
    const r = parseLLMResponse(makeResponse(`<complexity>todo</complexity>\n${bad}`));
    expect(r.specClarify).toBeUndefined();
  });

  it('ignores specClarify when body is `{}`', () => {
    const r = parseLLMResponse(
      makeResponse('<complexity>todo</complexity><specClarify>{}</specClarify>')
    );
    expect(r.specClarify).toBeUndefined();
  });

  it('ignores specClarify when body is literal `null`', () => {
    const r = parseLLMResponse(
      makeResponse('<complexity>todo</complexity><specClarify>null</specClarify>')
    );
    expect(r.specClarify).toBeUndefined();
  });

  it('returns undefined when specClarify tag is absent', () => {
    const r = parseLLMResponse(makeResponse('<complexity>todo</complexity>'));
    expect(r.specClarify).toBeUndefined();
  });
});

describe('parseLLMResponse — output-shape sanity', () => {
  it('oneshot + targetFiles keeps tasks empty (matrix row)', () => {
    const r = parseLLMResponse(
      makeResponse(
        '<complexity>oneshot</complexity><directHints>{"targetFiles":["src/a.ts"]}</directHints>'
      )
    );
    expect(r.tasks).toEqual([]);
    expect(r.complexity).toBe('oneshot');
    expect(r.directHints?.targetFiles).toEqual(['src/a.ts']);
  });

  it('todo + specClarify keeps tasks empty (matrix row)', () => {
    const r = parseLLMResponse(
      makeResponse(
        '<complexity>todo</complexity>\n<specClarify>{"needsChoice":true,"reason":"r","displayMessage":"m","choiceOptions":{"positive":{"label":"p","action":"redirect_to_design"},"neutral":{"label":"n","action":"proceed_without_spec"},"negative":{"label":"c","action":"cancel"}}}</specClarify>'
      )
    );
    expect(r.tasks).toEqual([]);
    expect(r.specClarify?.needsChoice).toBe(true);
  });
});
