/**
 * Handoff Bundle Coherence — name-binding validator
 *
 * A handoff bundle is a multi-file system whose shared layers expose two
 * cross-file NAME apis: the custom properties `tokens/` declares, and the class
 * names each `components|entities/<name>.css` declares. Every other file binds
 * to those names. When a binding misses, nothing crashes — an unresolved
 * `var(--x)` falls back to `initial` and an unstyled class simply has no rule,
 * so a fully broken bundle renders as an unstyled shell with ZERO error signal.
 * This module is the signal.
 *
 * Pure and deterministic: rules in, findings out, caller owns severity handling.
 * Regex-level by design — the question is only "does this identifier exist
 * somewhere in the bundle", which needs no CSS/HTML AST.
 *
 * Seam note: kept in `infrastructure/workspace/` (not under the design graph) so
 * a diagnostics route or the code job can adopt it for hand-dropped bundles.
 */

import type { FileSystemPort } from '../../core/ports/filesystem.js';

/** One bundle member. `path` is bundle-relative and POSIX-separated. */
export interface BundleFile {
  path: string;
  content: string;
}

export type CoherenceCode =
  /** `var(--x)` with no fallback whose `--x` nothing in the bundle declares. */
  | 'undefined-css-var'
  /** A `class=` token with no matching `.token` rule reachable from that file. */
  | 'unstyled-class'
  /** An `@import` target that does not exist in the bundle. */
  | 'import-target-missing'
  /** A bundle `.css` unreachable from the entry stylesheet's import graph. */
  | 'css-not-imported'
  /** A `<link rel=stylesheet>` href that does not exist in the bundle. */
  | 'stylesheet-link-missing'
  /** A `--x` the guide cites in prose that `tokens/` never declares. */
  | 'guide-token-missing';

export type CoherenceSeverity = 'hard' | 'warn';

export interface CoherenceFinding {
  code: CoherenceCode;
  severity: CoherenceSeverity;
  /** Bundle-relative file the finding is anchored to. */
  file: string;
  /** Distinct offenders, capped at `symbolSampleCap`. */
  symbols: string[];
  /** True distinct-offender count (may exceed `symbols.length`). */
  count: number;
  /** Denominator the ratio was taken against (refs / classes / citations). */
  total: number;
  /** BEM blocks the offenders group into — `unstyled-class` only. */
  families?: string[];
  reason: string;
}

export interface BundleCoherenceReport {
  /** No `hard` findings. */
  ok: boolean;
  findings: CoherenceFinding[];
  hardCount: number;
  warnCount: number;
  inspected: number;
  /** Set when the scan was truncated or skipped — never silent. */
  skipped?: { reason: 'too-large' | 'too-many-files' | 'no-css'; detail: string };
}

export interface CoherenceThresholds {
  /** Unresolved unique `var()` names in one file that alone make it blocking. */
  varHardCount: number;
  /** …or this share of that file's unique references. */
  varHardRatio: number;
  /** Below this many unstyled classes, report nothing at all. */
  classSilentFloor: number;
  classHardCount: number;
  classHardRatio: number;
  guideHardCount: number;
  guideHardRatio: number;
  maxBytes: number;
  maxFiles: number;
  symbolSampleCap: number;
}

/**
 * Calibrated against the `lunar-biting-hedge` bundle: healthy files measured
 * 0–2% miss rates, broken files 55–88%. The thresholds sit inside that gap.
 */
export const COHERENCE_THRESHOLDS: CoherenceThresholds = {
  varHardCount: 5,
  varHardRatio: 0.2,
  classSilentFloor: 3,
  classHardCount: 8,
  classHardRatio: 0.25,
  guideHardCount: 5,
  guideHardRatio: 0.25,
  maxBytes: 2_000_000,
  maxFiles: 200,
  symbolSampleCap: 12,
};

export interface CoherenceOptions {
  /** Anchor findings only to these bundle-relative paths (per-task scope). */
  only?: string[];
  /** Checks to run; default = every code. */
  checks?: CoherenceCode[];
  thresholds?: Partial<CoherenceThresholds>;
}

/** Class-token prefixes exempt from `unstyled-class` (JS-toggled / utility hooks). */
export const STATE_CLASS_PREFIXES = ['is-', 'has-', 'js-', 'u-', 'no-'] as const;

const ALL_CODES: CoherenceCode[] = [
  'undefined-css-var',
  'unstyled-class',
  'import-target-missing',
  'css-not-imported',
  'stylesheet-link-missing',
  'guide-token-missing',
];

const ENTRY_STYLESHEET = 'styles.css';

// ── extractors ────────────────────────────────────────────────────────────────

export function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

export function stripHtmlComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, ' ');
}

export function extractCssVarDefs(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)) out.add(m[1]);
  return out;
}

export function extractCssVarRefs(text: string): Array<{ name: string; hasFallback: boolean }> {
  const out: Array<{ name: string; hasFallback: boolean }> = [];
  for (const m of text.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*(,?)/g)) {
    out.push({ name: m[1], hasFallback: m[2] === ',' });
  }
  return out;
}

/**
 * Class names a stylesheet declares. `url(...)` and `@import` lines are stripped
 * first so a relative asset path never registers its extension as a class.
 */
export function extractCssClassSelectors(css: string): Set<string> {
  const cleaned = stripCssComments(css)
    .replace(/url\([^)]*\)/g, ' ')
    .replace(/^\s*@import[^;]*;?/gm, ' ');
  const out = new Set<string>();
  for (const m of cleaned.matchAll(/\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g)) out.add(m[1]);
  return out;
}

export function extractHtmlStyleBlocks(html: string): string[] {
  return [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]);
}

export function extractHtmlClassTokens(html: string): Set<string> {
  const out = new Set<string>();
  for (const m of stripHtmlComments(html).matchAll(/\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    for (const token of (m[1] ?? m[2] ?? '').split(/\s+/)) {
      if (token) out.add(token);
    }
  }
  return out;
}

export function extractCssImports(css: string): string[] {
  const out: string[] = [];
  for (const m of stripCssComments(css).matchAll(/@import\s+(?:url\(\s*)?["']([^"']+)["']/g)) {
    out.push(m[1]);
  }
  return out;
}

export function extractStylesheetLinks(html: string): string[] {
  const out: string[] = [];
  for (const m of stripHtmlComments(html).matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/rel\s*=\s*["']?[^"'>]*stylesheet/i.test(tag)) continue;
    const href = tag.match(/href\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const value = href?.[1] ?? href?.[2];
    if (value) out.push(value);
  }
  return out;
}

export function extractCitedTokenNames(markdown: string): string[] {
  return [...markdown.matchAll(/`(--[A-Za-z0-9_-]+)`/g)].map(m => m[1]);
}

// ── helpers ───────────────────────────────────────────────────────────────────

const isExternalRef = (ref: string): boolean =>
  /^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('//');

/** Resolve a bundle-relative reference made from inside `fromFile`. */
function resolveRef(fromFile: string, ref: string): string | null {
  if (isExternalRef(ref)) return null;
  const base = fromFile.split('/').slice(0, -1);
  const segments = ref.replace(/[?#].*$/, '').split('/');
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') base.pop();
    else base.push(segment);
  }
  return base.join('/');
}

const extOf = (path: string): string => {
  const dot = path.lastIndexOf('.');
  return dot < 0 ? '' : path.slice(dot).toLowerCase();
};

const bemBlock = (token: string): string => token.split('__')[0].split('--')[0];

const isStateClass = (token: string): boolean =>
  STATE_CLASS_PREFIXES.some(prefix => token.startsWith(prefix));

const isTokenLayer = (path: string): boolean => path.startsWith('tokens/');

/** Shared-layer css must be imported; a Ring-3 directory only warns. */
const isSharedLayerCss = (path: string): boolean =>
  isTokenLayer(path) || path.startsWith('components/') || path.startsWith('entities/');

function finding(
  code: CoherenceCode,
  severity: CoherenceSeverity,
  file: string,
  offenders: string[],
  total: number,
  reason: string,
  cap: number,
  families?: string[],
): CoherenceFinding {
  return {
    code,
    severity,
    file,
    symbols: offenders.slice(0, cap),
    count: offenders.length,
    total,
    ...(families ? { families } : {}),
    reason,
  };
}

// ── rule set ──────────────────────────────────────────────────────────────────

/**
 * Evaluate every coherence rule over a bundle snapshot. Never throws.
 *
 * Findings report only MISSING references against the whole snapshot's symbol
 * set, so an incomplete snapshot can produce a false negative — never a false
 * positive. That is what makes per-task (partial-bundle) scoping sound.
 */
export function evaluateBundleCoherence(
  files: BundleFile[],
  opts: CoherenceOptions = {},
): BundleCoherenceReport {
  const t = { ...COHERENCE_THRESHOLDS, ...opts.thresholds };
  const checks = new Set(opts.checks ?? ALL_CODES);
  const scope = opts.only ? new Set(opts.only) : null;
  const inScope = (path: string) => !scope || scope.has(path);

  const empty = (skipped?: BundleCoherenceReport['skipped']): BundleCoherenceReport => ({
    ok: true,
    findings: [],
    hardCount: 0,
    warnCount: 0,
    inspected: files.length,
    ...(skipped ? { skipped } : {}),
  });

  if (files.length === 0) return empty();
  if (files.length > t.maxFiles) {
    return empty({ reason: 'too-many-files', detail: `${files.length} files > ${t.maxFiles}` });
  }
  const totalBytes = files.reduce((sum, f) => sum + f.content.length, 0);
  if (totalBytes > t.maxBytes) {
    return empty({ reason: 'too-large', detail: `${totalBytes} bytes > ${t.maxBytes}` });
  }

  const byPath = new Map(files.map(f => [f.path, f]));
  const cssFiles = files.filter(f => extOf(f.path) === '.css');
  const htmlFiles = files.filter(f => ['.html', '.htm'].includes(extOf(f.path)));
  const mdFiles = files.filter(f => extOf(f.path) === '.md');
  if (cssFiles.length === 0) {
    return empty({ reason: 'no-css', detail: 'bundle snapshot carries no stylesheet' });
  }

  // Custom properties: declared anywhere in css/html (never markdown — the guide
  // must not satisfy its own citations).
  const declaredVars = new Set<string>();
  for (const f of [...cssFiles, ...htmlFiles]) {
    const body = extOf(f.path) === '.css' ? stripCssComments(f.content) : stripHtmlComments(f.content);
    for (const name of extractCssVarDefs(body)) declaredVars.add(name);
  }
  const tokenLayerVars = new Set<string>();
  for (const f of cssFiles.filter(f => isTokenLayer(f.path))) {
    for (const name of extractCssVarDefs(stripCssComments(f.content))) tokenLayerVars.add(name);
  }

  // Class selectors: the shared layer is every stylesheet; a page additionally
  // reaches its own `<style>` scaffolding (and nobody else's).
  const sharedClasses = new Set<string>();
  for (const f of cssFiles) {
    for (const name of extractCssClassSelectors(f.content)) sharedClasses.add(name);
  }

  const findings: CoherenceFinding[] = [];

  if (checks.has('undefined-css-var')) {
    for (const f of [...cssFiles, ...htmlFiles]) {
      if (!inScope(f.path)) continue;
      const body = extOf(f.path) === '.css' ? stripCssComments(f.content) : stripHtmlComments(f.content);
      const unique = new Map<string, boolean>();
      for (const ref of extractCssVarRefs(body)) {
        // A literal fallback makes the reference legitimate on its own.
        unique.set(ref.name, (unique.get(ref.name) ?? true) && ref.hasFallback);
      }
      const unresolved = [...unique.entries()]
        .filter(([name, alwaysHasFallback]) => !alwaysHasFallback && !declaredVars.has(name))
        .map(([name]) => name)
        .sort();
      if (unresolved.length === 0) continue;
      const ratio = unresolved.length / unique.size;
      const hard = unresolved.length >= t.varHardCount || ratio >= t.varHardRatio;
      findings.push(
        finding(
          'undefined-css-var',
          hard ? 'hard' : 'warn',
          f.path,
          unresolved,
          unique.size,
          `${unresolved.length} of ${unique.size} custom properties this file reads are declared nowhere in the bundle`,
          t.symbolSampleCap,
        ),
      );
    }
  }

  if (checks.has('unstyled-class')) {
    for (const f of htmlFiles) {
      if (!inScope(f.path)) continue;
      const localClasses = new Set<string>();
      for (const block of extractHtmlStyleBlocks(stripHtmlComments(f.content))) {
        for (const name of extractCssClassSelectors(block)) localClasses.add(name);
      }
      const used = [...extractHtmlClassTokens(f.content)].filter(token => !isStateClass(token));
      const unstyled = used
        .filter(token => !sharedClasses.has(token) && !localClasses.has(token))
        .sort();
      if (unstyled.length < t.classSilentFloor) continue;
      const ratio = unstyled.length / used.length;
      const hard = unstyled.length >= t.classHardCount && ratio >= t.classHardRatio;
      findings.push(
        finding(
          'unstyled-class',
          hard ? 'hard' : 'warn',
          f.path,
          unstyled,
          used.length,
          `${unstyled.length} of ${used.length} class names in this page have no rule in the bundle's stylesheets or its own <style>`,
          t.symbolSampleCap,
          [...new Set(unstyled.map(bemBlock))].sort(),
        ),
      );
    }
  }

  if (checks.has('import-target-missing')) {
    for (const f of cssFiles) {
      if (!inScope(f.path)) continue;
      const missing = extractCssImports(f.content)
        .map(ref => ({ ref, resolved: resolveRef(f.path, ref) }))
        .filter(({ resolved }) => resolved !== null && !byPath.has(resolved))
        .map(({ ref }) => ref);
      if (missing.length === 0) continue;
      findings.push(
        finding(
          'import-target-missing',
          'hard',
          f.path,
          [...new Set(missing)].sort(),
          missing.length,
          'these @import targets do not exist in the bundle',
          t.symbolSampleCap,
        ),
      );
    }
  }

  if (checks.has('stylesheet-link-missing')) {
    for (const f of htmlFiles) {
      if (!inScope(f.path)) continue;
      const missing = extractStylesheetLinks(f.content)
        .map(ref => ({ ref, resolved: resolveRef(f.path, ref) }))
        .filter(({ resolved }) => resolved !== null && !byPath.has(resolved))
        .map(({ ref }) => ref);
      if (missing.length === 0) continue;
      findings.push(
        finding(
          'stylesheet-link-missing',
          'hard',
          f.path,
          [...new Set(missing)].sort(),
          missing.length,
          'these linked stylesheets do not exist in the bundle',
          t.symbolSampleCap,
        ),
      );
    }
  }

  if (checks.has('css-not-imported') && byPath.has(ENTRY_STYLESHEET)) {
    const reachable = new Set<string>([ENTRY_STYLESHEET]);
    const queue = [ENTRY_STYLESHEET];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const file = byPath.get(current);
      if (!file) continue;
      for (const ref of extractCssImports(file.content)) {
        const resolved = resolveRef(current, ref);
        if (resolved && byPath.has(resolved) && !reachable.has(resolved)) {
          reachable.add(resolved);
          queue.push(resolved);
        }
      }
    }
    for (const f of cssFiles) {
      if (reachable.has(f.path) || !inScope(f.path)) continue;
      findings.push(
        finding(
          'css-not-imported',
          isSharedLayerCss(f.path) ? 'hard' : 'warn',
          f.path,
          [f.path],
          cssFiles.length,
          `not reachable from ${ENTRY_STYLESHEET} — pages that link only the entry stylesheet never load it`,
          t.symbolSampleCap,
        ),
      );
    }
  }

  if (checks.has('guide-token-missing') && tokenLayerVars.size > 0) {
    for (const f of mdFiles) {
      if (!inScope(f.path)) continue;
      const cited = [...new Set(extractCitedTokenNames(f.content))];
      if (cited.length === 0) continue;
      const missing = cited.filter(name => !tokenLayerVars.has(name)).sort();
      if (missing.length === 0) continue;
      const ratio = missing.length / cited.length;
      const hard = missing.length >= t.guideHardCount || ratio >= t.guideHardRatio;
      findings.push(
        finding(
          'guide-token-missing',
          hard ? 'hard' : 'warn',
          f.path,
          missing,
          cited.length,
          `${missing.length} of ${cited.length} token names this guide cites are not declared under tokens/ — every consumer that follows the guide inherits the divergence`,
          t.symbolSampleCap,
        ),
      );
    }
  }

  const order: Record<CoherenceSeverity, number> = { hard: 0, warn: 1 };
  findings.sort((a, b) => order[a.severity] - order[b.severity] || a.file.localeCompare(b.file) || a.code.localeCompare(b.code));

  const hardCount = findings.filter(f => f.severity === 'hard').length;
  return {
    ok: hardCount === 0,
    findings,
    hardCount,
    warnCount: findings.length - hardCount,
    inspected: files.length,
  };
}

const CODE_LABELS: Record<CoherenceCode, string> = {
  'undefined-css-var': 'custom properties declared nowhere',
  'unstyled-class': 'class names with no rule',
  'import-target-missing': 'missing @import targets',
  'css-not-imported': 'stylesheet never imported',
  'stylesheet-link-missing': 'missing linked stylesheet',
  'guide-token-missing': 'guide cites undeclared token names',
};

/** Human-readable block for chat / console / a retry prompt. */
export function formatCoherenceReport(
  report: BundleCoherenceReport,
  opts: { bundleDir: string },
): string {
  if (report.skipped) {
    return `⚠️ Bundle coherence not checked for \`${opts.bundleDir}\` (${report.skipped.reason}: ${report.skipped.detail}).`;
  }
  if (report.findings.length === 0) {
    return `✅ Bundle coherence clean for \`${opts.bundleDir}\` (${report.inspected} files).`;
  }
  const lines = report.findings.map(f => {
    const badge = f.severity === 'hard' ? '❌' : '⚠️';
    const sample = f.symbols.join(', ');
    const more = f.count > f.symbols.length ? ` (+${f.count - f.symbols.length} more)` : '';
    const families = f.families?.length ? `\n    families: ${f.families.join(', ')}` : '';
    return `  ${badge} \`${f.file}\` — ${CODE_LABELS[f.code]}: ${f.reason}\n    ${sample}${more}${families}`;
  });
  return [
    `Bundle coherence for \`${opts.bundleDir}\`: ${report.hardCount} blocking, ${report.warnCount} advisory.`,
    ...lines,
  ].join('\n');
}

// ── fs loader ─────────────────────────────────────────────────────────────────

const INSPECTED_EXTENSIONS = ['.css', '.html', '.htm', '.md'];

/**
 * Load the inspectable members of a bundle. `bundleDirRel` must already be
 * resolved by the caller — path conventions differ per call site (learn works
 * workspace-relative, task gates join a feature path), so this helper never
 * re-derives one.
 */
export async function loadHandoffBundleFiles(
  fileSystem: Pick<FileSystemPort, 'listFiles' | 'readFile'>,
  bundleDirRel: string,
  limits: { maxBytes?: number; maxFiles?: number } = {},
): Promise<{ files: BundleFile[]; skipped?: BundleCoherenceReport['skipped'] }> {
  const maxBytes = limits.maxBytes ?? COHERENCE_THRESHOLDS.maxBytes;
  const maxFiles = limits.maxFiles ?? COHERENCE_THRESHOLDS.maxFiles;
  const prefix = bundleDirRel.replace(/\/+$/, '');

  let entries: string[];
  try {
    entries = await fileSystem.listFiles(prefix);
  } catch {
    return { files: [], skipped: { reason: 'no-css', detail: `cannot list ${prefix}` } };
  }

  const candidates = entries.filter(entry => INSPECTED_EXTENSIONS.includes(extOf(entry)));
  if (candidates.length > maxFiles) {
    return { files: [], skipped: { reason: 'too-many-files', detail: `${candidates.length} files > ${maxFiles}` } };
  }

  const files: BundleFile[] = [];
  let bytes = 0;
  for (const entry of candidates) {
    const content = await fileSystem.readFile(entry).catch(() => null);
    if (content === null) continue;
    bytes += content.length;
    if (bytes > maxBytes) {
      return { files: [], skipped: { reason: 'too-large', detail: `> ${maxBytes} bytes under ${prefix}` } };
    }
    const relative = entry.startsWith(`${prefix}/`) ? entry.slice(prefix.length + 1) : entry;
    files.push({ path: relative, content });
  }
  return { files };
}
