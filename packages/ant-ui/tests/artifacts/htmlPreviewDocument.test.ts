/**
 * HTML artifact preview — relative-reference resolution.
 *
 * A design handoff bundle is a mini static site: `screens/home.html` links
 * `../styles.css`, which `@import`s `tokens/*.css`. The preview renders the
 * live buffer through a blob URL, whose opaque path resolves no relative
 * reference at all — every stylesheet silently failed, leaving each `var(--…)`
 * at `initial` (collapsed layout, black text on the dark canvas). The injected
 * `<base href>` is what restores that graph, so it must land before the first
 * `<link>` in every document shape the generator emits.
 */

import { describe, it, expect } from 'vitest';
import { resolveHtmlPreviewFrame, withBaseHref } from '@/domain/file/htmlPreviewDocument';

const BASE = 'https://ant-app.example.com/workspace/abc123/visual/ui/handoff/screens/';

describe('withBaseHref', () => {
  it('inserts the base as the first child of <head>', () => {
    const html = '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n</head>\n<body></body>\n</html>';
    const out = withBaseHref(html, BASE);
    expect(out).toContain(`<base href="${BASE}">`);
    expect(out.indexOf('<base')).toBeLessThan(out.indexOf('<meta'));
  });

  it('places the base before the first stylesheet link', () => {
    const html = '<head><link rel="stylesheet" href="../styles.css"></head>';
    const out = withBaseHref(html, BASE);
    expect(out.indexOf('<base')).toBeLessThan(out.indexOf('<link'));
  });

  it('matches <head> with attributes and any case', () => {
    for (const head of ['<HEAD>', '<Head class="x">', '<head data-a="1">']) {
      const out = withBaseHref(`${head}<title>t</title></head>`, BASE);
      expect(out).toContain(`<base href="${BASE}">`);
      expect(out.indexOf('<base')).toBeLessThan(out.indexOf('<title>'));
    }
  });

  it('synthesizes a head right after <html> when the document has none', () => {
    const out = withBaseHref('<!doctype html>\n<html lang="en">\n<body>x</body>\n</html>', BASE);
    expect(out).toContain(`<head><base href="${BASE}"></head>`);
    expect(out.indexOf('<base')).toBeLessThan(out.indexOf('<body'));
  });

  it('prepends a head for a bare fragment', () => {
    const out = withBaseHref('<div class="card">x</div>', BASE);
    expect(out.startsWith(`<head><base href="${BASE}"></head>`)).toBe(true);
  });

  it("keeps the author's own <base> — their intent wins", () => {
    const html = '<head><base href="/elsewhere/"><title>t</title></head>';
    expect(withBaseHref(html, BASE)).toBe(html);
  });

  it('is a no-op without a base URL (project/feature not resolved yet)', () => {
    const html = '<head><title>t</title></head>';
    expect(withBaseHref(html, '')).toBe(html);
  });

  it('escapes attribute-breaking characters in the URL', () => {
    const out = withBaseHref('<head></head>', 'http://h/a"b&c/');
    expect(out).toContain('<base href="http://h/a&quot;b&amp;c/">');
  });
});

/**
 * The preview frame truth table — ONE row, keyed on what the server answered.
 *
 * It used to have two, and the second was the original defect: where a
 * deployment published no distinct content origin, the base pointed at the
 * `files-raw` byte route, so a link to a folder rendered
 * `{"error":"Path is a directory, not a file"}` inside the frame. The lane is
 * now mounted on both planes, so there is nothing to fall back to.
 *
 * The invariant is still the point: a blob document carries the APP origin, so
 * `allow-scripts` together with `allow-same-origin` would give an LLM-authored
 * page the session cookie and `window.parent`.
 */
describe('resolveHtmlPreviewFrame', () => {
  const contentBase = 'https://ant-app.example.com/workspace/abc/docs/';
  const inertBase = 'https://api.example.com/workspace/abc/docs/';

  it('scripts on where the server published a distinct content origin', () => {
    const frame = resolveHtmlPreviewFrame({ baseHref: contentBase, allowScripts: true });
    expect(frame.baseHref).toBe(contentBase);
    expect(frame.sandbox).toContain('allow-scripts');
  });

  it('scripts off on the inert control-plane lane — browsing still works', () => {
    const frame = resolveHtmlPreviewFrame({ baseHref: inertBase, allowScripts: false });
    expect(frame.baseHref).toBe(inertBase);
    expect(frame.sandbox).not.toContain('allow-scripts');
  });

  it.each([
    ['content origin', contentBase, true],
    ['inert control plane', inertBase, false],
  ])('%s: never allow-same-origin, always allow-popups', (_label, baseHref, allowScripts) => {
    const { sandbox } = resolveHtmlPreviewFrame({ baseHref, allowScripts });
    expect(sandbox).not.toContain('allow-same-origin');
    // Without this a `target="_blank"` link dies silently on click — the other
    // half of the reported "the link does nothing" symptom.
    expect(sandbox).toContain('allow-popups');
  });

  it('the base is used verbatim — the frontend computes no part of it', () => {
    expect(resolveHtmlPreviewFrame({ baseHref: inertBase, allowScripts: false }).baseHref)
      .toBe(inertBase);
  });
});
