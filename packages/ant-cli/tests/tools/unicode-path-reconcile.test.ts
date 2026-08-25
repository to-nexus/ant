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
import { reconcileOnDiskPath, toNfc, nfcEquals, type ExistenceProbe } from '../../src/core/utils/unicodePath';
import { normalizeTemplateDoc } from '../../src/core/utils/templateDetector';
import { handleCopyFile } from '../../src/agents/common/tool/handlers/copyFile';
import { handleReadFile } from '../../src/agents/common/tool/handlers';
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
