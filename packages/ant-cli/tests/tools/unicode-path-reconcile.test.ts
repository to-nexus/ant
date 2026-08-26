/**
 * NFC/NFD path reconcile — zinc-bracing-gavel RCA.
 *
 * macOS uploads land on Linux/EFS with NFD filenames; the LLM re-emits the
 * same glyphs in NFC. Byte-exact resolution made `copy_file` report a visibly
 * present file as "source not found" while `read_file`'s binary fast path
 * fabricated success — looping the job. `reconcileOnDiskPath` maps a requested
 * path onto the on-disk byte form; these tests run against a fake probe so the
 * byte-form assertions are deterministic on both darwin (whose APFS lookups
 * are normalization-insensitive) and Linux CI.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  reconcileOnDiskPath,
  toNfc,
  nfcEquals,
  buildNfcTolerantRegex,
  globNormalizationVariants,
  type ExistenceProbe,
} from '../../src/core/utils/unicodePath';
import { normalizeTemplateDoc } from '../../src/core/utils/templateDetector';
import { applySearchReplace } from '../../src/core/streaming/strategies/common/EditOperations';
import { handleCopyFile } from '../../src/agents/common/tool/handlers/copyFile';
import { handleReadFile } from '../../src/agents/common/tool/handlers';
import { handleSearchCode } from '../../src/agents/common/tool/handlers/searchCode';
import { nfdCommandHint } from '../../src/agents/common/tool/handlers/runCommand';
import { FileSystemAdapter } from '../../src/periphery/adapters/filesystem/FileSystemAdapter';
import type { ToolExecutionContext } from '../../src/agents/common/tool/types';

const NFD_NAME = '스크린샷 2026-08-21 오후 11.28.03.png'.normalize('NFD');
const NFC_NAME = NFD_NAME.normalize('NFC');

/** Byte-exact in-memory probe: `files` are full relative paths, NFD or mixed. */
function fakeProbe(files: string[]): ExistenceProbe & { readdirCalls: number } {
  const all = new Set<string>();
  for (const f of files) {
    const segs = f.split('/');
    for (let i = 1; i <= segs.length; i++) all.add(segs.slice(0, i).join('/'));
  }
  const probe = {
    readdirCalls: 0,
    async fileExists(p: string) {
      return all.has(p);
    },
    async readDirectory(p: string) {
      probe.readdirCalls++;
      const prefix = p === '.' ? '' : `${p}/`;
      const names = new Set<string>();
      for (const entry of all) {
        if (prefix && !entry.startsWith(prefix)) continue;
        const rest = prefix ? entry.slice(prefix.length) : entry;
        if (!rest || rest.includes('/')) {
          if (rest) names.add(rest.split('/')[0]);
          continue;
        }
        names.add(rest);
      }
      return [...names].map((name) => ({ name, isDirectory: !all.has(prefix + name) || [...all].some(e => e.startsWith(`${prefix}${name}/`)) }));
    },
  };
  return probe;
}

describe('reconcileOnDiskPath', () => {
  it('maps an NFC request onto the NFD on-disk byte form', async () => {
    const probe = fakeProbe([`visual/ui/handoff/${NFD_NAME}`]);
    const r = await reconcileOnDiskPath(probe, `visual/ui/handoff/${NFC_NAME}`);
    expect(r.reconciled).toBe(true);
    expect(r.fsPath).toBe(`visual/ui/handoff/${NFD_NAME}`);
  });

  it('byte-exact NFD request is returned unchanged without enumeration', async () => {
    const probe = fakeProbe([`visual/ui/handoff/${NFD_NAME}`]);
    const r = await reconcileOnDiskPath(probe, `visual/ui/handoff/${NFD_NAME}`);
    expect(r).toEqual({ fsPath: `visual/ui/handoff/${NFD_NAME}`, reconciled: false });
    expect(probe.readdirCalls).toBe(0);
  });

  it('pure-ASCII path short-circuits with zero fs calls', async () => {
    const probe = fakeProbe([]);
    let touched = false;
    probe.fileExists = async () => { touched = true; return false; };
    const r = await reconcileOnDiskPath(probe, 'codebase/src/index.ts');
    expect(r).toEqual({ fsPath: 'codebase/src/index.ts', reconciled: false });
    expect(touched).toBe(false);
  });

  it('fully missing path stays verbatim (create target)', async () => {
    const probe = fakeProbe(['visual/ui/handoff/other.png']);
    const r = await reconcileOnDiskPath(probe, `assets/${NFC_NAME}`);
    expect(r.fsPath).toBe(`assets/${NFC_NAME}`);
    expect(r.reconciled).toBe(false);
  });

  it('reconciles an NFD parent directory while keeping a missing NFC leaf verbatim', async () => {
    const dirNfd = '한글폴더'.normalize('NFD');
    const dirNfc = dirNfd.normalize('NFC');
    const probe = fakeProbe([`${dirNfd}/existing.txt`]);
    const r = await reconcileOnDiskPath(probe, `${dirNfc}/새파일.txt`.normalize('NFC'));
    expect(r.fsPath).toBe(`${dirNfd}/${'새파일.txt'.normalize('NFC')}`);
    expect(r.reconciled).toBe(true);
  });

  it('prefers the byte-exact entry when both normalization forms exist on disk', async () => {
    const probe = fakeProbe([`dir/${NFD_NAME}`, `dir/${NFC_NAME}`]);
    const r = await reconcileOnDiskPath(probe, `dir/${NFC_NAME}`);
    expect(r).toEqual({ fsPath: `dir/${NFC_NAME}`, reconciled: false });
  });
});

describe('toNfc / nfcEquals', () => {
  it('nfcEquals matches across forms; toNfc is idempotent', () => {
    expect(nfcEquals(NFD_NAME, NFC_NAME)).toBe(true);
    expect(toNfc(NFD_NAME)).toBe(NFC_NAME);
    expect(toNfc(NFC_NAME)).toBe(NFC_NAME);
  });
});

describe('NFC/NFD integration — real filesystem (the zinc-bracing-gavel scenario)', () => {
  function makeCtx(workspacePath: string): ToolExecutionContext {
    const noop = async () => undefined as any;
    return {
      fileSystem: new FileSystemAdapter(workspacePath),
      chatStatus: new Proxy({}, { get: () => noop }) as ToolExecutionContext['chatStatus'],
      workingDir: workspacePath,
      allowMutateInCodebase: true,
    } as ToolExecutionContext;
  }

  /** Minimal valid PNG header + payload so integrity verification passes. */
  function makePng(): Buffer {
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdr = Buffer.alloc(25);
    ihdr.writeUInt32BE(13, 0);
    ihdr.write('IHDR', 4, 'latin1');
    ihdr.writeUInt32BE(1, 8);
    ihdr.writeUInt32BE(1, 12);
    ihdr[16] = 8; ihdr[17] = 6;
    return Buffer.concat([sig, ihdr, Buffer.alloc(64, 7)]);
  }

  it('copy_file with an NFC source finds the NFD file on disk', async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-nfc-'));
    try {
      const png = makePng();
      fs.mkdirSync(path.join(ws, 'visual/ui/handoff'), { recursive: true });
      fs.writeFileSync(path.join(ws, 'visual/ui/handoff', NFD_NAME), png);

      const result = await handleCopyFile(makeCtx(ws), {
        source: `visual/ui/handoff/${NFC_NAME}`,
        destination: 'codebase/images/screenshot-1.png',
      });

      expect(result.error).toBeUndefined();
      const written = fs.readFileSync(path.join(ws, 'codebase/images/screenshot-1.png'));
      expect(written.equals(png)).toBe(true);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it('read_file of a nonexistent binary path returns not-found, never a fabricated success', async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-nfc-'));
    try {
      const result = await handleReadFile(makeCtx(ws), { path: 'assets/missing.png' });
      expect(result.error).toBeDefined();
      expect(result.content).toMatch(/File not found/);
      expect(result.content).not.toMatch(/\[Binary file/);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it('read_file of an existing binary reports it as binary and recommends copy_file', async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-nfc-'));
    try {
      fs.mkdirSync(path.join(ws, 'assets'), { recursive: true });
      fs.writeFileSync(path.join(ws, 'assets', NFD_NAME), makePng());
      const result = await handleReadFile(makeCtx(ws), { path: `assets/${NFC_NAME}` });
      expect(result.error).toBeUndefined();
      expect(result.content).toMatch(/\[Binary file/);
      expect(result.content).toMatch(/copy_file/);
      expect(result.content).not.toMatch(/run_command\("cp/);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});

describe('NFC content normalization at the prompt boundary (sure-judging-bluff)', () => {
  const NFD_TEXT = '통보 체계 · 환불 처리'.normalize('NFD');
  const NFC_TEXT = NFD_TEXT.normalize('NFC');

  function makeBoundaryCtx(workspacePath: string): ToolExecutionContext {
    const noop = async () => undefined as any;
    return {
      fileSystem: new FileSystemAdapter(workspacePath),
      chatStatus: new Proxy({}, { get: () => noop }) as ToolExecutionContext['chatStatus'],
      workingDir: workspacePath,
      allowMutateInCodebase: true,
    } as ToolExecutionContext;
  }

  it('normalizeTemplateDoc emits strictly NFC content', () => {
    const out = normalizeTemplateDoc(`# Report\n\n${NFD_TEXT}\n`);
    expect(out).toBeTruthy();
    expect(out).toContain(NFC_TEXT);
    // No conjoining jamo may survive the funnel.
    expect([...out!].some(c => c.charCodeAt(0) >= 0x1100 && c.charCodeAt(0) <= 0x11ff)).toBe(false);
  });

  it('normalizeTemplateDoc template-marker semantics are unaffected by NFD input', () => {
    expect(normalizeTemplateDoc(`<!-- ant:template -->\n# 제목\n`.normalize('NFD'))).toBeNull();
    const kept = normalizeTemplateDoc(`<!-- ant:template -->\n${NFD_TEXT} — substantial user content beyond the scaffold threshold, long enough to keep.\n`);
    expect(kept).toBeTruthy();
    expect(kept).not.toContain('ant:template');
    expect(kept).toContain(NFC_TEXT);
  });

  it('toNfc scope pin: canonical singletons fold, NFKC-only compat forms do not', () => {
    // CJK compatibility ideographs (U+F967 \u2192 U+4E0D) carry CANONICAL
    // singleton decompositions, so NFC folds them \u2014 which stabilizes the
    // exact confusable the incident thinking looped on. NFKC-only foldings
    // (width forms, ligatures) must stay untouched \u2014 NFKC would mangle code.
    expect(toNfc('\uF967')).toBe('\u4E0D');
    expect(toNfc('\uFF21')).toBe('\uFF21'); // fullwidth A unchanged (no NFKC)
  });

  it('read_file tool output stays byte-faithful (stage-2 explicitly out of scope)', async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-nfc-'));
    try {
      fs.mkdirSync(path.join(ws, 'codebase'), { recursive: true });
      fs.writeFileSync(path.join(ws, 'codebase/page.html'), `<h1>${NFD_TEXT}</h1>\n`);
      const result = await handleReadFile(makeBoundaryCtx(ws), { path: 'codebase/page.html' });
      expect(result.error).toBeUndefined();
      // Stage 1 normalizes read-only doc channels only; codebase reads keep
      // raw bytes so edit_file old_string matching stays exact.
      expect(result.content).toContain(NFD_TEXT);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});

describe('applySearchReplace NFC line-span fallback (navy-dropping-crowd)', () => {
  const NFD_LINE = '통보 체계 · 환불 처리'.normalize('NFD');
  const NFC_LINE = NFD_LINE.normalize('NFC');

  it('NFC old_str matches an NFD file line; bytes outside the span are untouched', () => {
    const original = `<header>\n  <h1>${NFD_LINE}</h1>\n</header>`;
    let note = '';
    const result = applySearchReplace(
      original, `  <h1>${NFC_LINE}</h1>`, '  <h1>REPLACED</h1>', 'codebase/page.html',
      (n) => { note = n; },
    );
    expect(result).toBe('<header>\n  <h1>REPLACED</h1>\n</header>');
    expect(note).toMatch(/NFC\/NFD normalization tolerance/);
  });

  it('matches the last line of a file with no trailing newline', () => {
    const original = `line1\n${NFD_LINE}`;
    const result = applySearchReplace(original, NFC_LINE, 'tail', 'f.md');
    expect(result).toBe('line1\ntail');
  });

  it('two NFC-equal spans are ambiguous → the exact-match error is thrown unchanged', () => {
    const original = `${NFD_LINE}\nmid\n${NFD_LINE}\n`;
    expect(() => applySearchReplace(original, NFC_LINE, 'x', 'codebase/a.ts'))
      .toThrowError('Search block not found in codebase/a.ts');
  });

  it('byte-exact path is untouched: first occurrence wins and no fallback note fires', () => {
    const original = `${NFD_LINE}\nmid\n${NFD_LINE}\n`;
    let note = '';
    const result = applySearchReplace(original, NFD_LINE, 'first', 'f.md', (n) => { note = n; });
    expect(result).toBe(`first\nmid\n${NFD_LINE}\n`);
    expect(note).toBe('');
  });

  it('old_str with a trailing newline consumes the newline like the byte path', () => {
    const original = `a\n${NFD_LINE}\nb\n`;
    const result = applySearchReplace(original, `${NFC_LINE}\n`, '', 'f.md');
    expect(result).toBe('a\nb\n');
  });

  it('CRLF on both sides still matches (\\r rides inside each line)', () => {
    const original = `a\r\n${NFD_LINE}\r\nb\r\n`;
    const result = applySearchReplace(original, `${NFC_LINE}\r`, 'x\r', 'f.md');
    expect(result).toBe('a\r\nx\r\nb\r\n');
  });
});

describe('buildNfcTolerantRegex / globNormalizationVariants', () => {
  const 한NFD = '한'.normalize('NFD');
  const 글NFD = '글'.normalize('NFD');

  it('substitutes per-codepoint NFC/NFD groups', () => {
    expect(buildNfcTolerantRegex('한글')).toBe(`(?:한|${한NFD})(?:글|${글NFD})`);
  });

  it('keeps ASCII regex structure around the runs', () => {
    expect(buildNfcTolerantRegex('id="한글"')).toBe(`id="(?:한|${한NFD})(?:글|${글NFD})"`);
  });

  it('a quantifier after an NFC run binds to the group (semantics preserved)', () => {
    expect(buildNfcTolerantRegex('한{2}')).toBe(`(?:한|${한NFD}){2}`);
  });

  it('fail-closed gates: character class, NFD-run+quantifier, nothing sensitive', () => {
    expect(buildNfcTolerantRegex('[한글]')).toBeNull();
    expect(buildNfcTolerantRegex(`${한NFD}?`)).toBeNull();
    expect(buildNfcTolerantRegex('plain ascii')).toBeNull();
  });

  it('glob variants: the other normalization form only; class-bearing/ASCII globs get none', () => {
    expect(globNormalizationVariants('codebase/한글.md')).toEqual([`codebase/${한NFD}${글NFD}.md`]);
    expect(globNormalizationVariants('codebase/**/*.ts')).toEqual([]);
    expect(globNormalizationVariants('codebase/[한글].md')).toEqual([]);
  });
});

describe('search_code NFC/NFD-tolerant zero-match retry (navy-dropping-crowd)', () => {
  const NFD_TEXT = '통보 체계 · 환불 처리'.normalize('NFD');
  const NFC_TEXT = NFD_TEXT.normalize('NFC');

  function makeSearchCtx(workspacePath: string): ToolExecutionContext {
    const noop = async () => undefined as any;
    return {
      fileSystem: new FileSystemAdapter(workspacePath),
      chatStatus: new Proxy({}, { get: () => noop }) as ToolExecutionContext['chatStatus'],
      workingDir: workspacePath,
    } as ToolExecutionContext;
  }

  it('NFC pattern finds NFD file content and annotates the result', async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-nfc-'));
    try {
      fs.mkdirSync(path.join(ws, 'codebase'), { recursive: true });
      fs.writeFileSync(path.join(ws, 'codebase/report.html'), `<h1>${NFD_TEXT}</h1>\n`);
      const result = await handleSearchCode(makeSearchCtx(ws), { pattern: '통보 체계'.normalize('NFC') });
      expect(result.error).toBeUndefined();
      expect(result.content).toContain('[unicode-note]');
      expect(result.content).toContain('codebase/report.html');
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it('character-class patterns skip the retry and return the zero-match message verbatim', async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-nfc-'));
    try {
      fs.mkdirSync(path.join(ws, 'codebase'), { recursive: true });
      fs.writeFileSync(path.join(ws, 'codebase/report.html'), `<h1>${NFD_TEXT}</h1>\n`);
      const result = await handleSearchCode(makeSearchCtx(ws), { pattern: `[${'통'.normalize('NFC')}]보` });
      expect(result.error).toBeUndefined();
      expect(result.content).toMatch(/^No matches found/);
      expect(result.content).not.toContain('[unicode-note]');
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it('NFC file_pattern reaches an NFD filename via the glob-union variants', async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-nfc-'));
    try {
      const nfdName = `${'스크린샷'.normalize('NFD')}.md`;
      fs.mkdirSync(path.join(ws, 'codebase/docs'), { recursive: true });
      fs.writeFileSync(path.join(ws, 'codebase/docs', nfdName), 'glob-union-marker\n');
      const result = await handleSearchCode(makeSearchCtx(ws), {
        pattern: 'glob-union-marker',
        file_pattern: `codebase/docs/${'스크린샷'.normalize('NFC')}.md`,
      });
      expect(result.error).toBeUndefined();
      expect(result.content).toContain('[unicode-note]');
      expect(result.content).toContain('glob-union-marker');
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it('byte-exact first-run matches carry no retry annotation', async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-nfc-'));
    try {
      fs.mkdirSync(path.join(ws, 'codebase'), { recursive: true });
      fs.writeFileSync(path.join(ws, 'codebase/a.ts'), 'const exactMarker = 1;\n');
      const result = await handleSearchCode(makeSearchCtx(ws), { pattern: 'exactMarker' });
      expect(result.error).toBeUndefined();
      expect(result.content).toContain('codebase/a.ts');
      expect(result.content).not.toContain('[unicode-note]');
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});

describe('nfdCommandHint (run_command miss annotation)', () => {
  const KOREAN_CMD = `find . -name '*${'스크린샷'.normalize('NFC')}*'`;

  it('fires on the miss shapes: not-found failure, empty failure, empty success', () => {
    expect(nfdCommandHint(KOREAN_CMD, 'find: no such file or directory', false)).toMatch(/Unicode note/);
    expect(nfdCommandHint(KOREAN_CMD, '', false)).toMatch(/Unicode note/);
    expect(nfdCommandHint(KOREAN_CMD, '', true)).toMatch(/Unicode note/);
  });

  it('stays silent for ASCII commands, successful output, and unrelated failures', () => {
    expect(nfdCommandHint("find . -name '*.png'", '', true)).toBe('');
    expect(nfdCommandHint(KOREAN_CMD, './docs/file.md', true)).toBe('');
    expect(nfdCommandHint(KOREAN_CMD, 'TypeError: x is not a function', false)).toBe('');
  });
});
