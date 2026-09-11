import * as fs from 'fs';
import * as path from 'path';
import { EXIT, type CliResult } from './commands';

export interface CheckReviewJson {
  files: number;
  rows: number;
  missing: string[];
  unknown: string[];
}

function walkMarkdown(dir: string, rel = ''): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name.startsWith('.')) return [];
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) return walkMarkdown(path.join(dir, e.name), childRel);
    return e.name.toLowerCase().endsWith('.md') ? [childRel] : [];
  });
}

/**
 * Column one of the first table under the first heading that names "Trace",
 * as the review prompts contract it. Placeholder rows (`{…}`) and the header /
 * separator rows are not paths.
 */
export function extractTracePaths(report: string): string[] | null {
  const lines = report.split(/\r?\n/);
  const start = lines.findIndex((l) => /^#{1,6}\s+.*trace/i.test(l));
  if (start === -1) return null;
  const cells: string[] = [];
  let inTable = false;
  let headerSeen = false;
  for (const line of lines.slice(start + 1)) {
    const isRow = /^\s*\|/.test(line);
    if (!isRow) {
      if (inTable) break;
      continue;
    }
    inTable = true;
    if (!headerSeen) {
      headerSeen = true;
      continue;
    }
    if (/^\s*\|\s*:?-{3,}/.test(line)) continue;
    const first = line.split('|')[1]?.trim().replace(/^`|`$/g, '').replace(/^\.\//, '') ?? '';
    if (!first || first.includes('{')) continue;
    cells.push(first);
  }
  return inTable ? cells : null;
}

/**
 * Diff a review report's Trace table against the material directory it was
 * written from: every markdown file under the material needs at least one row,
 * and every row must name a file. Paths match by suffix, so a row that kept the
 * attached directory's prefix (`material/x/work-a.md`) still finds `x/work-a.md`.
 */
export function runCheckReview(reportArg: string, materialDirArg: string): CliResult<CheckReviewJson> {
  const report = path.resolve(reportArg);
  const materialDir = path.resolve(materialDirArg);
  const usage = (msg: string): CliResult<CheckReviewJson> => ({
    exitCode: EXIT.USAGE,
    lines: [`error: ${msg}`],
    json: { files: 0, rows: 0, missing: [], unknown: [] },
  });
  if (!fs.existsSync(report) || !fs.statSync(report).isFile()) return usage(`${reportArg} is not a file`);
  if (!fs.existsSync(materialDir) || !fs.statSync(materialDir).isDirectory()) {
    return usage(`${materialDirArg} is not a directory`);
  }

  const files = walkMarkdown(materialDir).sort();
  const rows = extractTracePaths(fs.readFileSync(report, 'utf-8'));
  if (rows === null) {
    const msg = 'no table found under a heading that names "Trace" — the review skeleton\'s `## Trace` section is the contract';
    return { exitCode: EXIT.FINDINGS, lines: [`error: ${msg}`], json: { files: files.length, rows: 0, missing: files, unknown: [] } };
  }

  const matches = (cell: string, rel: string): boolean => cell === rel || cell.endsWith(`/${rel}`);
  const missing = files.filter((rel) => !rows.some((cell) => matches(cell, rel)));
  const unknown = Array.from(new Set(rows.filter((cell) => !files.some((rel) => matches(cell, rel)))));

  const lines = [
    ...missing.map((m) => `missing: ${m}`),
    ...unknown.map((u) => `unknown: ${u}`),
    `files: ${files.length} · rows: ${rows.length} · missing: ${missing.length} · unknown: ${unknown.length}`,
  ];
  return {
    exitCode: missing.length > 0 || unknown.length > 0 ? EXIT.FINDINGS : EXIT.CLEAN,
    lines,
    json: { files: files.length, rows: rows.length, missing, unknown },
  };
}
