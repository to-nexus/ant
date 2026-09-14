/**
 * The report skeletons are markdown with structural tokens — headings, a
 * count line, tables — that the builders' contracts declare never localized
 * and never renamed. These readers are the ONE parser for that shape, shared
 * by `check-review` and `check-report`.
 */

export interface MarkdownTable {
  headers: string[];
  rows: string[][];
}

const HEADING = /^(#{1,6})\s+(.*?)\s*$/;

/** `## ` headings in document order, text only. */
export function sectionHeadings(markdown: string, level = 2): string[] {
  const out: string[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const m = HEADING.exec(line);
    if (m && m[1].length === level) out.push(m[2]);
  }
  return out;
}

/** Body of the first heading matching `heading` up to the next heading of the same or higher level; null when absent. */
export function sectionBody(markdown: string, heading: RegExp): string | null {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => {
    const m = HEADING.exec(l);
    return m !== null && heading.test(m[2]);
  });
  if (start === -1) return null;
  const level = HEADING.exec(lines[start])![1].length;
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const m = HEADING.exec(line);
    if (m && m[1].length <= level) break;
    body.push(line);
  }
  return body.join('\n');
}

export function stripCell(cell: string): string {
  return cell.trim().replace(/^`|`$/g, '');
}

/**
 * First pipe table under the first heading matching `heading`. Header and
 * separator rows are split off; body rows keep their cells verbatim (trimmed,
 * outer backticks removed). Null when the heading is absent or no table
 * follows it before the next heading.
 */
export function extractTableUnder(markdown: string, heading: RegExp): MarkdownTable | null {
  const body = sectionBody(markdown, heading);
  if (body === null) return null;
  let headers: string[] | null = null;
  const rows: string[][] = [];
  let inTable = false;
  for (const line of body.split('\n')) {
    const isRow = /^\s*\|/.test(line);
    if (!isRow) {
      if (inTable) break;
      continue;
    }
    inTable = true;
    if (/^\s*\|\s*:?-{3,}/.test(line)) continue;
    const cells = line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map(stripCell);
    if (headers === null) headers = cells;
    else rows.push(cells);
  }
  return headers === null ? null : { headers, rows };
}

/** A skeleton row still carrying `{placeholders}` is not data. */
export function isPlaceholderRow(row: string[]): boolean {
  return row.some((c) => c.includes('{'));
}

/**
 * The count line — `key: N · key: N …` — that the report skeletons put under
 * the title. Read off the text before the first `## ` heading; null when no
 * such line is there.
 */
export function parseCountLine(markdown: string): Record<string, number> | null {
  const preamble = markdown.split(/\r?\n## /)[0];
  for (const line of preamble.split(/\r?\n/)) {
    const parts = line.split('·').map((p) => p.trim());
    if (parts.length < 2) continue;
    const counts: Record<string, number> = {};
    let ok = true;
    for (const part of parts) {
      const m = /^([a-z][a-z ]*?):\s*(\d+)$/i.exec(part);
      if (!m) {
        ok = false;
        break;
      }
      counts[m[1].toLowerCase()] = Number(m[2]);
    }
    if (ok) return counts;
  }
  return null;
}
