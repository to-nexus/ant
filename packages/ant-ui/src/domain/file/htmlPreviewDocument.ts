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

/** How the preview iframe is configured for one file. */
export interface HtmlPreviewFrame {
  baseHref: string;
  sandbox: string;
}

/**
 * Two rows, and never a third.
 *
 * Row 1 — the deployment publishes a content origin, so the preview browses a
 * real static site through a ticketed lane. No cookie is needed for its
 * subresources, which is exactly what lets `allow-same-origin` go: the frame
 * runs at an OPAQUE origin, so `allow-scripts` grants an LLM-authored document
 * no reachable capability. The two flags must never appear together — a blob
 * document carries the APP origin, and the pair would hand that document the
 * session cookie and `window.parent`.
 *
 * Row 2 — no distinct content origin (single-host, or a cloud whose content
 * ingress has not landed). Behaviour is exactly what it was before the lane
 * existed: subresources resolve through the byte route, and nothing scripts.
 */
export function resolveHtmlPreviewFrame(args: {
  contentBaseHref: string | null;
  rawDirHref: string;
}): HtmlPreviewFrame {
  return args.contentBaseHref
    ? { baseHref: args.contentBaseHref, sandbox: 'allow-scripts' }
    : { baseHref: args.rawDirHref, sandbox: 'allow-same-origin' };
}
