/**
 * Raw HTML is never enabled in a Markdown surface (report M-002).
 *
 * Markdown reaching a preview is not authored by the viewer: an artifact
 * transfer copies a sender's `.md` into the recipient's workspace, and agents
 * write Markdown into the feature tree. With `rehypeRaw` in the pipeline an
 * `<iframe srcdoc="<script>…">` in that document became a real, un-sandboxed
 * element on the app origin, and `createMarkdownComponents` is a styling map,
 * not a sanitizer — it overrides only `pre/code/a/table/th/td/p/h1..h3`, so
 * everything it does not name passes through.
 *
 * Two rows for one gate: the plugin is not wired anywhere (structural), and raw
 * HTML in fact renders as text (behavioural).
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { act, create } from 'react-test-renderer';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const SRC = path.resolve(__dirname, '../../src');

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(tsx?|jsx?)$/.test(entry)) yield full;
  }
}

describe('markdown surfaces do not enable raw HTML (M-002)', () => {
  it('no source file wires rehype-raw', () => {
    const offenders = [...walk(SRC)].filter(file => {
      const source = readFileSync(file, 'utf8');
      return source.includes('rehype-raw') || source.includes('rehypeRaw');
    });
    expect(offenders.map(f => path.relative(SRC, f))).toEqual([]);
  });

  it('raw HTML in a rendered document stays text', async () => {
    const malicious = '# Title\n\n<iframe srcdoc="<script>fetch(`/api/projects`)</script>"></iframe>\n';
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<ReactMarkdown remarkPlugins={[remarkGfm]}>{malicious}</ReactMarkdown>);
      await Promise.resolve();
    });

    // no element is created for the raw tag...
    expect(tree.root.findAllByType('iframe')).toEqual([]);
    expect(tree.root.findAllByType('script')).toEqual([]);
    // ...and the ordinary Markdown around it still renders
    expect(tree.root.findAllByType('h1')).toHaveLength(1);
  });
});
