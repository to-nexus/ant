/**
 * loadResolvedArtifacts — handoff stub behaviour
 *
 * Locks:
 *   - Handoff subtree entries are NEVER eager-loaded. utf-8 reads against
 *     binary files (png / woff) would otherwise produce garbage.
 *   - Each handoff file becomes a 3-line stub carrying path, size, and
 *     kind (text|binary) plus the on-demand access hint.
 *   - Text stubs instruct `read_file(<path>)`; binary stubs forbid it and
 *     direct the LLM to reference the path only.
 *   - ant / figma paths are unaffected — they still go through
 *     `readAndNormalize` and carry real content.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadResolvedArtifacts } from '../src/agents/common/graph/loadDocumentsForRAC';
import type { ResolvedActionContext } from '@ant/shared';

function rac(refs: string[] = [], context: string[] = []): ResolvedActionContext {
  return {
    intent: 'gen-code-directive',
    intentGroup: 'gen-code',
    mode: 'creation',
    refs,
    context,
  } as unknown as ResolvedActionContext;
}

describe('loadResolvedArtifacts — handoff stub semantics', () => {
  let featurePath: string;

  beforeAll(() => {
    featurePath = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-handoff-'));
    const handoffDir = path.join(featurePath, 'outputs/design/ui/handoff');
    fs.mkdirSync(handoffDir, { recursive: true });
    fs.writeFileSync(
      path.join(handoffDir, 'page.html'),
      '<html><body><h1>Hello</h1></body></html>',
    );
    fs.writeFileSync(
      path.join(handoffDir, 'styles.css'),
      'body { color: #1a1a2e; }',
    );
    // PNG magic header; real bytes don't matter for this test — we verify we
    // do NOT try to utf-8 decode them.
    fs.writeFileSync(
      path.join(handoffDir, 'hero.png'),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]),
    );
    // Nested asset to ensure the recursive walk still tags the subtree.
    const nested = path.join(handoffDir, 'assets');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, 'icon.svg'), '<svg></svg>');

    // Ant subtree — verify it is NOT affected by handoff stubbing.
    const antDir = path.join(featurePath, 'outputs/design/ui/ant');
    fs.mkdirSync(antDir, { recursive: true });
    fs.writeFileSync(
      path.join(antDir, 'ui-tokens.json'),
      '{"color":{"bg":"#000"}}',
    );
  });

  afterAll(() => {
    if (featurePath) fs.rmSync(featurePath, { recursive: true, force: true });
  });

  it('emits a stub (not content) for every handoff file when the directory is selected', () => {
    const artifacts = loadResolvedArtifacts(
      rac([], ['outputs/design/ui/handoff']),
      featurePath,
    );

    // 3 top-level + 1 nested = 4 files
    expect(artifacts).toHaveLength(4);

    const byPath = Object.fromEntries(artifacts.map(a => [a.path, a]));

    // Text file — stub, not the original html
    const html = byPath['outputs/design/ui/handoff/page.html'];
    expect(html).toBeDefined();
    expect(html.role).toBe('context');
    expect(html.content).toMatch(/\[handoff file\] outputs\/design\/ui\/handoff\/page\.html/);
    expect(html.content).toMatch(/kind: text/);
    expect(html.content).toMatch(/read_file\("outputs\/design\/ui\/handoff\/page\.html"\)/);
    expect(html.content).not.toContain('<h1>Hello</h1>');

    // Binary file — stub flags as binary and forbids read_file
    const png = byPath['outputs/design/ui/handoff/hero.png'];
    expect(png).toBeDefined();
    expect(png.content).toMatch(/\[handoff asset\] outputs\/design\/ui\/handoff\/hero\.png/);
    expect(png.content).toMatch(/kind: binary/);
    expect(png.content).toMatch(/do NOT call read_file/);

    // Nested svg — still stubbed (walkDir recurses), classified as text per
    // the readFile.ts policy (SVG is XML).
    const svg = byPath['outputs/design/ui/handoff/assets/icon.svg'];
    expect(svg).toBeDefined();
    expect(svg.content).toMatch(/kind: text/);
    expect(svg.content).not.toContain('<svg></svg>');
  });

  it('stubs a single handoff file path as well (not only directory-scoped input)', () => {
    const artifacts = loadResolvedArtifacts(
      rac([], ['outputs/design/ui/handoff/styles.css']),
      featurePath,
    );
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].path).toBe('outputs/design/ui/handoff/styles.css');
    expect(artifacts[0].content).toMatch(/\[handoff file\]/);
    expect(artifacts[0].content).not.toContain('#1a1a2e');
  });

  it('leaves ant UiSource entries unaffected — real content is still injected', () => {
    const artifacts = loadResolvedArtifacts(
      rac([], ['outputs/design/ui/ant/ui-tokens.json']),
      featurePath,
    );
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].path).toBe('outputs/design/ui/ant/ui-tokens.json');
    expect(artifacts[0].content).toContain('"bg":"#000"');
    expect(artifacts[0].content).not.toMatch(/\[handoff/);
  });
});
