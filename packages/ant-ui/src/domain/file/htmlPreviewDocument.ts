/**
 * The HTML preview renders a blob document, whose URL carries an opaque path —
 * relative references (`../styles.css`, `../assets/x.svg`) have nothing to
 * resolve against, so a design handoff bundle renders with zero external CSS.
 * Injecting an absolute `<base href>` pointing at the file's real directory
 * restores the whole relative graph while keeping the live (unsaved) buffer as
 * the preview source.
 */

const HEAD_OPEN = /<head\b[^>]*>/i;
const HTML_OPEN = /<html\b[^>]*>/i;
const EXISTING_BASE = /<base\b[^>]*>/i;

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/**
 * Insert `<base href>` as the first child of `<head>`. A document that already
 * declares its own base keeps it — the author's intent wins.
 */
export function withBaseHref(html: string, baseHref: string): string {
  if (!baseHref) return html;
  if (EXISTING_BASE.test(html)) return html;

  const tag = `<base href="${escapeAttr(baseHref)}">`;

  const head = HEAD_OPEN.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + tag + html.slice(at);
  }

  // No `<head>`: put one right after `<html>` so the base still precedes any
  // `<link>` the body-less document may carry.
  const htmlTag = HTML_OPEN.exec(html);
  if (htmlTag) {
    const at = htmlTag.index + htmlTag[0].length;
    return `${html.slice(0, at)}<head>${tag}</head>${html.slice(at)}`;
  }

  return `<head>${tag}</head>${html}`;
}
