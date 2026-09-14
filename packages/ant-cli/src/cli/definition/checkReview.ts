import * as fs from 'fs';
import * as path from 'path';
import { EXIT, type CliResult } from './commands';
import { extractTableUnder, isPlaceholderRow } from './markdownTable';

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
 * as the review prompts contract it. Placeholder rows (`{…}`) are not paths.
 */
export function extractTracePaths(report: string): string[] | null {
  const table = extractTableUnder(report, /trace/i);
  if (!table) return null;
  return table.rows
    .filter((row) => !isPlaceholderRow(row.slice(0, 1)))
    .map((row) => (row[0] ?? '').replace(/^\.\//, ''))
    .filter((cell) => cell.length > 0);
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
