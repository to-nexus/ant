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

const BASE = 'http://localhost:4200/api/projects/p/features/main/files-raw/visual/ui/handoff/screens/';

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
 * The preview frame truth table. Two rows and one invariant — the invariant is
 * the point: a blob document carries the APP origin, so `allow-scripts` together
 * with `allow-same-origin` would give an LLM-authored page the session cookie
 * and `window.parent`.
 */
describe('resolveHtmlPreviewFrame', () => {
  const rawDirHref = 'https://api.example.com/api/projects/p/features/main/files-raw/docs/';
  const contentBaseHref = 'https://ant-app.example.com/workspace/abc/docs/';

  it('browses the ticketed content lane, scripts on, when a content origin exists', () => {
    const frame = resolveHtmlPreviewFrame({ contentBaseHref, rawDirHref });
    expect(frame.baseHref).toBe(contentBaseHref);
    expect(frame.sandbox).toContain('allow-scripts');
  });

  it('falls back to the byte route, scripts off, when there is no content origin', () => {
    const frame = resolveHtmlPreviewFrame({ contentBaseHref: null, rawDirHref });
    expect(frame.baseHref).toBe(rawDirHref);
    expect(frame.sandbox).toBe('allow-same-origin');
  });

  it.each([
    ['content origin', contentBaseHref],
    ['fallback', null],
  ])('never combines allow-scripts with allow-same-origin (%s row)', (_label, base) => {
    const { sandbox } = resolveHtmlPreviewFrame({ contentBaseHref: base, rawDirHref });
    expect(sandbox.includes('allow-scripts') && sandbox.includes('allow-same-origin')).toBe(false);
  });
});
