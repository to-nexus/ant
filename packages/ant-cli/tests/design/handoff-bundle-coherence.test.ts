/**
 * Axis: handoff bundle name-binding rule set.
 *
 * Locks the BEHAVIOUR of `evaluateBundleCoherence` — which misses are reported,
 * at which severity, and which are deliberately silent. Table-driven over
 * synthetic bundles; no fs, no mocks, no prompt prose.
 *
 * Calibration comes from the `lunar-biting-hedge` bundle, where healthy files
 * measured 0–2% miss rates and broken files 55–88% — a ~25-point empty band the
 * thresholds sit inside.
 */
import { describe, it, expect } from 'vitest';
import {
  evaluateBundleCoherence,
  formatCoherenceReport,
  extractCssVarDefs,
  extractCssVarRefs,
  extractCssClassSelectors,
  extractHtmlClassTokens,
  extractCssImports,
  extractStylesheetLinks,
  extractCitedTokenNames,
  type BundleFile,
  type CoherenceCode,
} from '../../src/infrastructure/workspace/handoffBundleCoherence';

const repeat = (n: number, fn: (i: number) => string): string =>
  Array.from({ length: n }, (_, i) => fn(i)).join('\n');

const tokensDeclaring = (n: number, prefix = '--color-x'): BundleFile => ({
  path: 'tokens/colors.css',
  content: `:root {\n${repeat(n, i => `  ${prefix}${i}: #00${i};`)}\n}`,
});

const classes = (names: string[]): string => names.map(n => `.${n}{color:red}`).join('\n');
const markup = (names: string[], extra = ''): string =>
  `${extra}<div class="${names.join(' ')}"></div>`;

/** Codes present at a given severity, for compact table assertions. */
const codesAt = (files: BundleFile[], severity: 'hard' | 'warn'): CoherenceCode[] =>
  evaluateBundleCoherence(files)
    .findings.filter(f => f.severity === severity)
    .map(f => f.code)
    .sort();

describe('extractors', () => {
  it('separates var declarations from var references', () => {
    const css = ':root{--a:1px}\n.x{margin:var(--a);padding:var(--b, 2px)}';
    expect([...extractCssVarDefs(css)]).toEqual(['--a']);
    expect(extractCssVarRefs(css)).toEqual([
      { name: '--a', hasFallback: false },
      { name: '--b', hasFallback: true },
    ]);
  });

  it('does not read a relative asset path as a class selector', () => {
    const found = extractCssClassSelectors('.a{background:url(./pic.svg)}\n@import "tokens/x.css";');
    expect([...found]).toEqual(['a']);
  });

  it('reads class tokens from both quote styles and skips comments', () => {
    const html = `<div class="a b"></div><span class='c'></span><!-- <i class="ghost"> -->`;
    expect([...extractHtmlClassTokens(html)].sort()).toEqual(['a', 'b', 'c']);
  });

  it('reads imports, stylesheet links, and backticked token citations', () => {
    expect(extractCssImports('@import url("tokens/a.css");\n@import "b.css";')).toEqual([
      'tokens/a.css',
      'b.css',
    ]);
    expect(
      extractStylesheetLinks('<link rel="stylesheet" href="../styles.css"><link rel="icon" href="i.png">'),
    ).toEqual(['../styles.css']);
    expect(extractCitedTokenNames('use `--a` but not --b')).toEqual(['--a']);
  });
});

describe('undefined-css-var', () => {
  const cases: Array<{ name: string; consumer: string; expect: 'none' | 'warn' | 'hard' }> = [
    {
      name: 'every ref resolves',
      consumer: repeat(10, i => `.a${i}{color:var(--color-x${i})}`),
      expect: 'none',
    },
    {
      name: 'all 10 of 10 refs unresolved',
      consumer: repeat(10, i => `.a${i}{color:var(--ghost-${i})}`),
      expect: 'hard',
    },
    {
      name: '1 of 50 unresolved — below both hard thresholds',
      consumer: `${repeat(49, i => `.a${i}{color:var(--color-x${i})}`)}\n.z{color:var(--ghost)}`,
      expect: 'warn',
    },
    {
      name: 'literal fallback makes the reference legitimate',
      consumer: '.a{margin:var(--ghost, 4px)}',
      expect: 'none',
    },
    {
      name: 'commented-out reference is not live',
      consumer: '/* .a{margin:var(--ghost)} */\n.b{color:var(--color-x0)}',
      expect: 'none',
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const files = [tokensDeclaring(50), { path: 'components/c.css', content: c.consumer }];
      const report = evaluateBundleCoherence(files, { checks: ['undefined-css-var'] });
      const finding = report.findings.find(f => f.file === 'components/c.css');
      if (c.expect === 'none') expect(finding).toBeUndefined();
      else expect(finding?.severity).toBe(c.expect);
    });
  }

  it('a var declared in the page\'s own <style> resolves there', () => {
    const files = [
      tokensDeclaring(5),
      { path: 'screens/s.html', content: '<style>:root{--local:1px}\n.a{margin:var(--local)}</style>' },
    ];
    expect(codesAt(files, 'hard')).not.toContain('undefined-css-var');
  });
});

describe('unstyled-class', () => {
  const shared = (n: number): BundleFile => ({
    path: 'components/c.css',
    content: classes(Array.from({ length: n }, (_, i) => `ok${i}`)),
  });

  const cases: Array<{ name: string; used: string[]; styled: number; expect: 'none' | 'warn' | 'hard' }> = [
    { name: 'all classes have a rule', used: ['ok0', 'ok1', 'ok2'], styled: 3, expect: 'none' },
    {
      name: '20 of 20 unstyled',
      used: Array.from({ length: 20 }, (_, i) => `ghost${i}`),
      styled: 0,
      expect: 'hard',
    },
    {
      name: '1 of 55 unstyled — below the silent floor',
      used: [...Array.from({ length: 54 }, (_, i) => `ok${i}`), 'ghost'],
      styled: 54,
      expect: 'none',
    },
    {
      name: '4 of 60 unstyled — reported but not blocking',
      used: [
        ...Array.from({ length: 56 }, (_, i) => `ok${i}`),
        'ghostA',
        'ghostB',
        'ghostC',
        'ghostD',
      ],
      styled: 56,
      expect: 'warn',
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const files = [shared(c.styled), { path: 'screens/s.html', content: markup(c.used) }];
      const report = evaluateBundleCoherence(files, { checks: ['unstyled-class'] });
      const finding = report.findings.find(f => f.file === 'screens/s.html');
      if (c.expect === 'none') expect(finding).toBeUndefined();
      else expect(finding?.severity).toBe(c.expect);
    });
  }

  it('classes declared in the page\'s own <style> are its own scaffolding', () => {
    const files = [
      shared(1),
      {
        path: 'screens/s.html',
        content: markup(
          Array.from({ length: 20 }, (_, i) => `local${i}`),
          `<style>${classes(Array.from({ length: 20 }, (_, i) => `local${i}`))}</style>`,
        ),
      },
    ];
    expect(evaluateBundleCoherence(files, { checks: ['unstyled-class'] }).findings).toEqual([]);
  });

  it('does not credit ANOTHER page\'s local <style>', () => {
    const files = [
      shared(1),
      { path: 'screens/a.html', content: `<style>${classes(Array.from({ length: 20 }, (_, i) => `local${i}`))}</style>` },
      { path: 'screens/b.html', content: markup(Array.from({ length: 20 }, (_, i) => `local${i}`)) },
    ];
    const report = evaluateBundleCoherence(files, { checks: ['unstyled-class'] });
    expect(report.findings.map(f => f.file)).toEqual(['screens/b.html']);
  });

  it('state / utility prefixes are exempt', () => {
    const used = ['ok0', 'is-open', 'has-error', 'js-hook', 'u-hidden', 'no-scroll'];
    const files = [shared(1), { path: 'screens/s.html', content: markup(used) }];
    expect(evaluateBundleCoherence(files, { checks: ['unstyled-class'] }).findings).toEqual([]);
  });

  it('resolves compound, pseudo, attribute and descendant selectors', () => {
    const files = [
      { path: 'components/c.css', content: '.a.b{}\n.a:hover{}\n.c::before{}\n.d[data-x]{}\n.e > .f{}\n.g .h{}' },
      { path: 'screens/s.html', content: markup(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) },
    ];
    expect(evaluateBundleCoherence(files, { checks: ['unstyled-class'] }).findings).toEqual([]);
  });

  it('groups offenders into BEM families', () => {
    const files = [
      { path: 'components/c.css', content: classes(['ok']) },
      {
        path: 'components/c.html',
        content: markup([
          ...Array.from({ length: 5 }, (_, i) => `specimen-page__p${i}`),
          ...Array.from({ length: 5 }, (_, i) => `content-preview--v${i}`),
        ]),
      },
    ];
    const finding = evaluateBundleCoherence(files, { checks: ['unstyled-class'] }).findings[0];
    expect(finding.families).toEqual(['content-preview', 'specimen-page']);
  });
});

describe('import graph and stylesheet links', () => {
  it('flags an @import target that does not exist', () => {
    const files: BundleFile[] = [
      { path: 'styles.css', content: '@import url("tokens/colors.css");\n@import url("tokens/nope.css");' },
      tokensDeclaring(2),
    ];
    const report = evaluateBundleCoherence(files, { checks: ['import-target-missing'] });
    expect(report.hardCount).toBe(1);
    expect(report.findings[0].symbols).toEqual(['tokens/nope.css']);
  });

  it('flags a shared-layer stylesheet the entry never imports, and only warns for a Ring-3 dir', () => {
    const files: BundleFile[] = [
      { path: 'styles.css', content: '@import url("tokens/colors.css");' },
      tokensDeclaring(2),
      { path: 'components/orphan.css', content: '.a{}' },
      { path: 'ext/extra.css', content: '.b{}' },
    ];
    const report = evaluateBundleCoherence(files, { checks: ['css-not-imported'] });
    expect(report.findings.map(f => [f.file, f.severity])).toEqual([
      ['components/orphan.css', 'hard'],
      ['ext/extra.css', 'warn'],
    ]);
  });

  it('follows the import graph transitively', () => {
    const files: BundleFile[] = [
      { path: 'styles.css', content: '@import url("tokens/index.css");' },
      { path: 'tokens/index.css', content: '@import url("colors.css");' },
      tokensDeclaring(2),
    ];
    expect(evaluateBundleCoherence(files, { checks: ['css-not-imported'] }).findings).toEqual([]);
  });

  it('flags a linked stylesheet that does not exist and resolves ../ correctly', () => {
    const files: BundleFile[] = [
      { path: 'styles.css', content: '@import url("tokens/colors.css");' },
      tokensDeclaring(2),
      { path: 'screens/ok.html', content: '<link rel="stylesheet" href="../styles.css">' },
      { path: 'screens/bad.html', content: '<link rel="stylesheet" href="../nope.css">' },
    ];
    const report = evaluateBundleCoherence(files, { checks: ['stylesheet-link-missing'] });
    expect(report.findings.map(f => f.file)).toEqual(['screens/bad.html']);
  });
});

describe('guide-token-missing', () => {
  const guide = (real: number, ghost: number): BundleFile => ({
    path: 'DESIGN.md',
    content: [
      repeat(real, i => `- \`--color-x${i}\` exists.`),
      repeat(ghost, i => `- \`--ghost-${i}\` does not.`),
    ].join('\n'),
  });

  it('is silent when every citation resolves', () => {
    const files = [tokensDeclaring(5), guide(3, 0)];
    expect(evaluateBundleCoherence(files, { checks: ['guide-token-missing'] }).findings).toEqual([]);
  });

  it('blocks at the measured 23-of-45 divergence', () => {
    const files = [tokensDeclaring(30), guide(22, 23)];
    const finding = evaluateBundleCoherence(files, { checks: ['guide-token-missing'] }).findings[0];
    expect(finding.severity).toBe('hard');
    expect(finding.count).toBe(23);
    expect(finding.total).toBe(45);
  });

  it('ignores unbackticked prose mentions', () => {
    const files: BundleFile[] = [
      tokensDeclaring(5),
      { path: 'DESIGN.md', content: 'we may later add --ghost-token to the palette' },
    ];
    expect(evaluateBundleCoherence(files, { checks: ['guide-token-missing'] }).findings).toEqual([]);
  });

  it('does not let the guide satisfy its own citations', () => {
    const files: BundleFile[] = [
      tokensDeclaring(1),
      { path: 'DESIGN.md', content: '```css\n:root{--ghost-0:red}\n```\ncite `--ghost-0` here' },
    ];
    const finding = evaluateBundleCoherence(files, { checks: ['guide-token-missing'] }).findings[0];
    expect(finding.symbols).toEqual(['--ghost-0']);
  });
});

describe('scoping and safety', () => {
  const broken: BundleFile[] = [
    tokensDeclaring(2),
    { path: 'components/a.css', content: repeat(10, i => `.x${i}{color:var(--ghost-${i})}`) },
    { path: 'components/b.css', content: repeat(10, i => `.y${i}{color:var(--phantom-${i})}`) },
  ];

  it('`only` anchors findings to the named file', () => {
    const report = evaluateBundleCoherence(broken, { only: ['components/b.css'] });
    expect(report.findings.map(f => f.file)).toEqual(['components/b.css']);
  });

  it('`checks` runs just the requested rule', () => {
    const files: BundleFile[] = [
      ...broken,
      { path: 'screens/s.html', content: markup(Array.from({ length: 20 }, (_, i) => `ghost${i}`)) },
    ];
    expect(codesAt(files, 'hard')).toContain('unstyled-class');
    const scoped = evaluateBundleCoherence(files, { checks: ['undefined-css-var'] });
    expect(scoped.findings.every(f => f.code === 'undefined-css-var')).toBe(true);
  });

  it('reports a skip instead of throwing when the snapshot is too large', () => {
    const report = evaluateBundleCoherence([{ path: 'a.css', content: 'x'.repeat(50) }], {
      thresholds: { maxBytes: 10 },
    });
    expect(report.skipped?.reason).toBe('too-large');
    expect(report.ok).toBe(true);
  });

  it('reports a skip when there are too many files', () => {
    const files = Array.from({ length: 5 }, (_, i) => ({ path: `a${i}.css`, content: '.a{}' }));
    expect(evaluateBundleCoherence(files, { thresholds: { maxFiles: 2 } }).skipped?.reason).toBe(
      'too-many-files',
    );
  });

  it('handles an empty bundle and a css-less bundle without throwing', () => {
    expect(evaluateBundleCoherence([]).ok).toBe(true);
    expect(evaluateBundleCoherence([{ path: 'DESIGN.md', content: '# g' }]).skipped?.reason).toBe('no-css');
  });
});

describe('calibration against the measured lunar-biting-hedge shape', () => {
  // Severities only — the point is that healthy files stay quiet and broken
  // ones block, not that the exact counts never move.
  const files: BundleFile[] = [
    tokensDeclaring(40),
    { path: 'styles.css', content: '@import url("tokens/colors.css");\n@import url("components/chip.css");' },
    {
      // metadata-chip.css: 36 of 45 refs unresolved
      path: 'components/chip.css',
      content: [
        repeat(9, i => `.chip__ok${i}{color:var(--color-x${i})}`),
        repeat(36, i => `.chip--v${i}{background:var(--surface-metadata-${i})}`),
      ].join('\n'),
    },
    {
      // specimen: 23 of 26 classes unowned
      path: 'components/chip.html',
      content: markup([
        'chip__ok0',
        'chip__ok1',
        'chip__ok2',
        ...Array.from({ length: 13 }, (_, i) => `specimen-page__p${i}`),
        ...Array.from({ length: 5 }, (_, i) => `chip--domain${i}`),
        ...Array.from({ length: 5 }, (_, i) => `content-preview__c${i}`),
      ]),
    },
    {
      // operator-admin.html: 1 of 55 unstyled → must stay silent
      path: 'screens/operator-admin.html',
      content: markup([...Array.from({ length: 54 }, (_, i) => `op${i}`), 'site-header__nav-item'], `<style>${classes(Array.from({ length: 54 }, (_, i) => `op${i}`))}</style>`),
    },
  ];

  const report = evaluateBundleCoherence(files);
  const byFile = new Map(report.findings.map(f => [f.file, f]));

  it.each([
    ['components/chip.css', 'hard'],
    ['components/chip.html', 'hard'],
  ])('%s blocks', (file, severity) => {
    expect(byFile.get(file)?.severity).toBe(severity);
  });

  it('the self-contained screen produces no finding', () => {
    expect(byFile.has('screens/operator-admin.html')).toBe(false);
  });

  it('renders a report naming the offending files', () => {
    const text = formatCoherenceReport(report, { bundleDir: 'visual/ui/handoff' });
    expect(text).toContain('components/chip.css');
    expect(text).toContain('--surface-metadata-0');
    expect(report.ok).toBe(false);
  });
});
