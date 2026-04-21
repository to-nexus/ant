import { describe, it, expect } from 'vitest';
import { parseClarifyTags, stripClarifyTags } from '../src/agents/common/clarify';

/**
 * Regression coverage for the canonical `<clarify>` tag parser. Absorbs
 * the former planner-local `clarify.ts` test surface and covers the
 * design docGen bare-body syntax that previously used an inline regex.
 */
describe('parseClarifyTags — attribute syntax (planner)', () => {
  it('parses one block with options', () => {
    const text = [
      '<clarify question="What is the target platform?">',
      '<option>a) Web</option>',
      '<option>b) Mobile</option>',
      '</clarify>',
    ].join('\n');
    const blocks = parseClarifyTags(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].question).toBe('What is the target platform?');
    expect(blocks[0].options).toEqual(['a) Web', 'b) Mobile']);
  });

  it('parses multiple blocks in one text', () => {
    const text = `
      <clarify question="Q1?">
        <option>a) X</option>
      </clarify>
      Prose between.
      <clarify question="Q2?">
        <option>a) Y</option>
        <option>b) Z</option>
      </clarify>
    `;
    const blocks = parseClarifyTags(text);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].question).toBe('Q1?');
    expect(blocks[1].options).toEqual(['a) Y', 'b) Z']);
  });
});

describe('parseClarifyTags — bare-body syntax (design docGen)', () => {
  it('uses the tag body as the question when no attribute is present', () => {
    const text = `<clarify>
- What is the auth provider?
- Which database?
</clarify>`;
    const blocks = parseClarifyTags(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].question).toContain('What is the auth provider?');
    expect(blocks[0].question).toContain('Which database?');
    expect(blocks[0].options).toEqual([]);
  });
});

describe('parseClarifyTags — edge cases', () => {
  it('returns empty array when no <clarify> tags are present', () => {
    expect(parseClarifyTags('just prose, no tags')).toEqual([]);
  });

  it('ignores an empty <clarify> tag', () => {
    expect(parseClarifyTags('<clarify></clarify>')).toEqual([]);
  });

  it('is safe when called repeatedly (no shared regex state leakage)', () => {
    const text = '<clarify question="Q?"><option>a) X</option></clarify>';
    const first = parseClarifyTags(text);
    const second = parseClarifyTags(text);
    expect(first).toEqual(second);
    expect(first).toHaveLength(1);
  });
});

describe('stripClarifyTags', () => {
  it('removes attribute-syntax clarify and keeps surrounding prose', () => {
    const text = `Before.
<clarify question="Q?">
<option>a) X</option>
</clarify>
After.`;
    const cleaned = stripClarifyTags(text);
    expect(cleaned).not.toContain('<clarify');
    expect(cleaned).not.toContain('<option>');
    expect(cleaned).toContain('Before.');
    expect(cleaned).toContain('After.');
  });

  it('removes bare-body clarify', () => {
    const text = `Intro.
<clarify>
- Q1?
- Q2?
</clarify>
Outro.`;
    const cleaned = stripClarifyTags(text);
    expect(cleaned).not.toContain('<clarify>');
    expect(cleaned).toContain('Intro.');
    expect(cleaned).toContain('Outro.');
  });

  it('removes all occurrences when multiple blocks exist', () => {
    const text = '<clarify question="A?"><option>a) x</option></clarify> middle <clarify question="B?"><option>a) y</option></clarify>';
    expect(stripClarifyTags(text)).toBe('middle');
  });

  it('is a no-op when no clarify tag is present', () => {
    expect(stripClarifyTags('plain text')).toBe('plain text');
  });
});
