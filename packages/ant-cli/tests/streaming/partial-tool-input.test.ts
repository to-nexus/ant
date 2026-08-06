/**
 * PartialToolInputParser — table tests for the streaming tool-argument
 * scanner that feeds live file rendering (tool_use_delta channel).
 *
 * Contract locked here:
 *  - `path` surfaces as soon as its string value closes, regardless of
 *    fragment boundaries.
 *  - The content field streams UNESCAPED deltas (\" \\ \n \t \uXXXX), safe
 *    across arbitrary fragment splits (including mid-escape / mid-\uXXXX).
 *  - Non-content primitives (booleans etc.) surface as fields.
 *  - Nested object/array values are skipped without corrupting the scan.
 *  - Truncated input (max_tokens mid-call) leaves a usable content prefix.
 */

import { describe, it, expect } from 'vitest';
import { PartialToolInputParser, TOOL_CONTENT_FIELDS } from '../../src/core/streaming/partialToolInput';

function collect(contentField: string) {
  const fields: Array<[string, string]> = [];
  const deltas: string[] = [];
  let complete = false;
  const parser = new PartialToolInputParser({
    contentField,
    events: {
      onField: (k, v) => fields.push([k, v]),
      onContentDelta: (d) => deltas.push(d),
      onContentComplete: () => { complete = true; },
    },
  });
  return { parser, fields, deltas, isComplete: () => complete };
}

/** Push a JSON string split into n-char fragments. */
function pushChunked(parser: PartialToolInputParser, json: string, size: number) {
  for (let i = 0; i < json.length; i += size) parser.push(json.slice(i, i + size));
}

describe('PartialToolInputParser', () => {
  const CREATE_JSON = JSON.stringify({
    path: 'codebase/src/app.ts',
    content: 'const a = "x";\nconsole.log(a);\t// done \\ ok',
  });

  it.each([1, 2, 3, 7, 1000])('extracts path + unescaped content at fragment size %d', (size) => {
    const { parser, fields, deltas, isComplete } = collect('content');
    pushChunked(parser, CREATE_JSON, size);

    expect(fields).toContainEqual(['path', 'codebase/src/app.ts']);
    expect(parser.getField('path')).toBe('codebase/src/app.ts');
    expect(deltas.join('')).toBe('const a = "x";\nconsole.log(a);\t// done \\ ok');
    expect(parser.getContent()).toBe('const a = "x";\nconsole.log(a);\t// done \\ ok');
    expect(isComplete()).toBe(true);
    // Full-parse equivalence: the streamed field map matches JSON.parse.
    expect(parser.getField('content')).toBe(JSON.parse(CREATE_JSON).content);
  });

  it('path surfaces BEFORE content begins streaming (shell-open ordering)', () => {
    const { parser, fields, deltas } = collect('content');
    parser.push('{"path": "visual/ui/spec.md", "content": "# Ti');
    expect(fields).toContainEqual(['path', 'visual/ui/spec.md']);
    expect(deltas.join('')).toBe('# Ti');
    expect(parser.isContentComplete()).toBe(false);
  });

  it('handles \\uXXXX split across fragments', () => {
    const { parser, deltas } = collect('content');
    parser.push('{"content": "A\\u');
    parser.push('00e9');
    parser.push('B"}');
    expect(deltas.join('')).toBe('AéB');
  });

  it('handles escape backslash at exact fragment boundary', () => {
    const { parser, deltas } = collect('content');
    parser.push('{"content": "line1\\');
    parser.push('nline2"}');
    expect(deltas.join('')).toBe('line1\nline2');
  });

  it('edit_file: new_str streams, old_str is captured as a plain field', () => {
    const { parser, fields, deltas } = collect(TOOL_CONTENT_FIELDS.edit_file);
    const json = JSON.stringify({
      path: 'codebase/a.ts',
      old_str: 'const x = 1;',
      new_str: 'const x = 2; // updated',
    });
    pushChunked(parser, json, 5);
    expect(fields).toContainEqual(['path', 'codebase/a.ts']);
    expect(fields).toContainEqual(['old_str', 'const x = 1;']);
    expect(deltas.join('')).toBe('const x = 2; // updated');
  });

  it('non-string primitives surface as fields (overwrite flag)', () => {
    const { parser, fields } = collect('content');
    pushChunked(parser, '{"path":"a.md","overwrite":true,"content":"hi"}', 3);
    expect(fields).toContainEqual(['path', 'a.md']);
    expect(fields).toContainEqual(['overwrite', 'true']);
    expect(parser.getContent()).toBe('hi');
  });

  it('skips nested object/array values without corrupting the scan', () => {
    const { parser, fields } = collect('content');
    pushChunked(parser, '{"meta":{"a":[1,2,"}"],"b":"{"},"path":"x.md","content":"body"}', 4);
    expect(fields).toContainEqual(['path', 'x.md']);
    expect(parser.getContent()).toBe('body');
  });

  it('truncated input (max_tokens mid-content) leaves a usable prefix', () => {
    const { parser, isComplete } = collect('content');
    parser.push('{"path":"codebase/big.ts","content":"function main() {\\n  // part');
    expect(parser.getField('path')).toBe('codebase/big.ts');
    expect(parser.getContent()).toBe('function main() {\n  // part');
    expect(isComplete()).toBe(false);
  });

  it('keys containing escapes do not break key parsing', () => {
    const { parser } = collect('content');
    parser.push('{"pa\\u0074h":"a.md","content":"c"}');
    expect(parser.getField('path')).toBe('a.md');
  });

  it('TOOL_CONTENT_FIELDS covers exactly the file-writing tools', () => {
    expect(TOOL_CONTENT_FIELDS).toEqual({
      create_file: 'content',
      append_file: 'content',
      edit_file: 'new_str',
    });
  });
});
