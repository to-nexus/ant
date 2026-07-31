/**
 * Binary-safety gates — valid-crating-prawn regression suite.
 *
 * RCA: a user-supplied Duck.glb was destroyed by a utf-8 decode→re-encode
 * round trip (every invalid byte → U+FFFD, 119,644B → 198,440B), then
 * consumed silently by design/code jobs and shipped. These tests lock the
 * gates that make that class of corruption impossible or loud:
 *
 *   1. `FileOperationService.readFile`  — refuses binary (422 BINARY_FILE)
 *   2. `FileOperationService.writeFile` — refuses binary targets (BINARY_TARGET)
 *   3. `FileSystemAdapter.writeFile`    — single gate for every agent
 *      string-authoring surface (create_file / edit_file / <file> tag / append)
 *   4. `writeBufferVerified`            — byte-count + GLB header verification
 *   5. `sniffCorruptedBinary`           — poisoned-pool surfacing (inventory)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  writeBufferVerified,
  verifyBufferIntegrity,
  findGlbHeaderDefect,
  looksUtf8Corrupted,
  sniffCorruptedBinary,
} from '../../src/core/utils/binaryIntegrity';
import { isBinaryPath } from '../../src/core/utils/binaryExtensions';
import { FileSystemAdapter } from '../../src/periphery/adapters/filesystem/FileSystemAdapter';
import { UnifiedWorkspaceResolver } from '../../src/core/config/WorkspacePathResolver';
import {
  FileOperationService,
  BinaryFileOperationError,
} from '../../src/periphery/adapters/http/services/ProjectService/FileOperationService';

const ORG = 'o1';
const USER = 'u1';
const PROJECT = 'p1';
const FEATURE = 'main';
const USER_CTX = { userId: USER, organizationId: ORG } as any;

/** Minimal structurally-valid GLB: magic + version + declared length == size. */
function makeValidGlb(): Buffer {
  const jsonChunk = Buffer.from('{"asset":{"version":"2.0"}} ', 'utf-8'); // padded to 4-byte multiple
  const total = 12 + 8 + jsonChunk.length;
  const buf = Buffer.alloc(total);
  buf.write('glTF', 0, 'latin1');
  buf.writeUInt32LE(2, 4);
  buf.writeUInt32LE(total, 8);
  buf.writeUInt32LE(jsonChunk.length, 12);
  buf.write('JSON', 16, 'latin1');
  jsonChunk.copy(buf, 20);
  return buf;
}

/** Binary payload with many high bytes (so a utf-8 round trip visibly corrupts). */
function makeHighByteBinary(len = 4096): Buffer {
  const buf = Buffer.alloc(len);
  for (let i = 0; i < len; i++) buf[i] = (i * 37 + 128) % 256;
  return buf;
}

/** The exact corruption mechanism from the incident. */
function utf8RoundTrip(buf: Buffer): Buffer {
  return Buffer.from(buf.toString('utf-8'), 'utf-8');
}

describe('binary extension SSOT (@ant/shared re-export)', () => {
  it('classifies 3D/audio binary formats; keeps text formats out', () => {
    expect(isBinaryPath('assets/game/models/Duck.glb')).toBe(true);
    expect(isBinaryPath('a/b/model.FBX')).toBe(true);
    expect(isBinaryPath('sound.ogg')).toBe(true);
    // Text formats stay editable/readable — sniff handles impostors.
    expect(isBinaryPath('model.gltf')).toBe(false);
    expect(isBinaryPath('mesh.obj')).toBe(false);
    expect(isBinaryPath('icon.svg')).toBe(false);
  });
});

describe('utf-8 round-trip corruption detection', () => {
  it('utf8RoundTrip on a real GLB inflates it and saturates it with U+FFFD (incident signature)', () => {
    const glb = makeValidGlb();
    // Give it some high bytes in a BIN chunk region to make corruption visible.
    const withBin = Buffer.concat([glb, makeHighByteBinary(256)]);
    withBin.writeUInt32LE(withBin.length, 8);
    const corrupted = utf8RoundTrip(withBin);
    expect(corrupted.length).toBeGreaterThan(withBin.length);
    expect(looksUtf8Corrupted(corrupted)).toBe(true);
    expect(looksUtf8Corrupted(withBin)).toBe(false);
  });

  it('findGlbHeaderDefect: valid GLB passes; round-tripped GLB fails on declared length', () => {
    const glb = makeValidGlb();
    expect(findGlbHeaderDefect('/x/Duck.glb', glb)).toBeNull();
    const withBin = Buffer.concat([glb, makeHighByteBinary(256)]);
    withBin.writeUInt32LE(withBin.length, 8);
    const corrupted = utf8RoundTrip(withBin);
    expect(findGlbHeaderDefect('/x/Duck.glb', corrupted)).toMatch(/declared length|magic/);
    // Non-GLB paths are exempt from the header check.
    expect(findGlbHeaderDefect('/x/photo.png', corrupted)).toBeNull();
  });
});

describe('verifyBufferIntegrity — pre-write verdict on supplied bytes', () => {
  it('accepts an intact GLB and an intact PNG-shaped binary', () => {
    expect(verifyBufferIntegrity('Duck.glb', makeValidGlb())).toBeNull();
    expect(verifyBufferIntegrity('photo.png', makeHighByteBinary(2048))).toBeNull();
  });

  it('rejects the incident file shape: GLB whose declared length exceeds its size', () => {
    const withBin = Buffer.concat([makeValidGlb(), makeHighByteBinary(256)]);
    withBin.writeUInt32LE(withBin.length, 8);
    const corrupted = utf8RoundTrip(withBin);
    expect(verifyBufferIntegrity('assets/game/models/Duck.glb', corrupted)).toMatch(
      /declared length/,
    );
  });

  it('generalizes past GLB: a round-tripped PNG/OGG is rejected on U+FFFD saturation', () => {
    const roundTripped = utf8RoundTrip(makeHighByteBinary(2048));
    expect(verifyBufferIntegrity('sprite.png', roundTripped)).toMatch(/U\+FFFD/);
    expect(verifyBufferIntegrity('theme.ogg', roundTripped)).toMatch(/U\+FFFD/);
  });

  it('does not police text files (extension-gated)', () => {
    const suspicious = Buffer.from('�'.repeat(50), 'utf-8');
    expect(verifyBufferIntegrity('notes.md', suspicious)).toBeNull();
    expect(verifyBufferIntegrity('model.gltf', suspicious)).toBeNull();
  });
});

describe('filesystem-level gates', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ant-binary-safety-'));
  });
  afterEach(async () => {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  });

  describe('writeBufferVerified', () => {
    it('writes a valid GLB byte-identically', async () => {
      const glb = makeValidGlb();
      const dest = path.join(tmp, 'models', 'Duck.glb');
      await writeBufferVerified(dest, glb);
      expect(Buffer.compare(await fs.promises.readFile(dest), glb)).toBe(0);
    });

    it('refuses a mojibake GLB with code CORRUPTED_FILE and never creates the file', async () => {
      const withBin = Buffer.concat([makeValidGlb(), makeHighByteBinary(256)]);
      withBin.writeUInt32LE(withBin.length, 8);
      const corrupted = utf8RoundTrip(withBin);
      const dest = path.join(tmp, 'Duck.glb');
      // 422-shaped, not a 500: a corrupted supplied file is the caller's problem.
      await expect(writeBufferVerified(dest, corrupted)).rejects.toMatchObject({
        code: 'CORRUPTED_FILE',
        filename: 'Duck.glb',
      });
      expect(fs.existsSync(dest)).toBe(false);
    });
  });

  describe('sniffCorruptedBinary (inventory surfacing)', () => {
    it('flags a round-tripped .glb; passes a healthy one', async () => {
      const withBin = Buffer.concat([makeValidGlb(), makeHighByteBinary(512)]);
      withBin.writeUInt32LE(withBin.length, 8);

      const healthy = path.join(tmp, 'ok.glb');
      await fs.promises.writeFile(healthy, withBin);
      expect(sniffCorruptedBinary(healthy)).toBeNull();

      const poisoned = path.join(tmp, 'bad.glb');
      await fs.promises.writeFile(poisoned, utf8RoundTrip(withBin));
      expect(sniffCorruptedBinary(poisoned)).toMatch(/utf-8 round-trip/);
    });

    it('ignores non-binary-extension files', async () => {
      const p = path.join(tmp, 'notes.md');
      await fs.promises.writeFile(p, '�'.repeat(20), 'utf-8');
      expect(sniffCorruptedBinary(p)).toBeNull();
    });
  });

  describe('FileSystemAdapter.writeFile — single agent string-write gate', () => {
    it('refuses binary-extension targets; allows text', async () => {
      const adapter = new FileSystemAdapter(tmp);
      await expect(adapter.writeFile('public/models/Duck.glb', 'placeholder')).rejects.toThrow(
        /binary file/i,
      );
      await expect(adapter.writeFile('src/main.ts', 'export {};')).resolves.toBeUndefined();
      expect(fs.existsSync(path.join(tmp, 'public/models/Duck.glb'))).toBe(false);
    });
  });

  describe('FileOperationService read/write gates (HTTP text file API)', () => {
    let featurePath: string;
    let fileOps: FileOperationService;

    beforeEach(async () => {
      const resolver = new UnifiedWorkspaceResolver(tmp);
      fileOps = new FileOperationService(resolver);
      featurePath = resolver.getFeaturePath(USER_CTX, PROJECT, FEATURE);
      await fs.promises.mkdir(path.join(featurePath, 'assets/game/models'), { recursive: true });
    });

    it('readFile refuses binary content with code BINARY_FILE (422 at the route)', async () => {
      const glb = Buffer.concat([makeValidGlb(), makeHighByteBinary(128)]);
      glb.writeUInt32LE(glb.length, 8);
      await fs.promises.writeFile(path.join(featurePath, 'assets/game/models/Duck.glb'), glb);

      await expect(
        fileOps.readFile(PROJECT, FEATURE, 'assets/game/models/Duck.glb', USER_CTX),
      ).rejects.toMatchObject({ code: 'BINARY_FILE' });
    });

    it('readFile still reads text and 404s missing files with ENOENT', async () => {
      await fs.promises.writeFile(path.join(featurePath, 'note.md'), 'hello', 'utf-8');
      const res = await fileOps.readFile(PROJECT, FEATURE, 'note.md', USER_CTX);
      expect(res.content).toBe('hello');
      await expect(
        fileOps.readFile(PROJECT, FEATURE, 'missing.md', USER_CTX),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('writeFile refuses binary-extension targets (new file) with BINARY_TARGET', async () => {
      await expect(
        fileOps.writeFile(PROJECT, FEATURE, 'assets/game/models/New.glb', 'x', USER_CTX),
      ).rejects.toMatchObject({ code: 'BINARY_TARGET' });
    });

    it('writeFile refuses overwriting binary CONTENT behind a text extension (sniff backstop)', async () => {
      // The exact editor round-trip that destroyed Duck.glb, but with an
      // extension the whitelist does not know.
      const bin = Buffer.concat([Buffer.from([0x00, 0x01, 0x02]), makeHighByteBinary(64)]);
      await fs.promises.writeFile(path.join(featurePath, 'assets/game/models/mesh.custom'), bin);
      await expect(
        fileOps.writeFile(PROJECT, FEATURE, 'assets/game/models/mesh.custom', 'mojibake', USER_CTX),
      ).rejects.toMatchObject({ code: 'BINARY_TARGET' });
      // Bytes on disk untouched.
      const after = await fs.promises.readFile(path.join(featurePath, 'assets/game/models/mesh.custom'));
      expect(Buffer.compare(after, bin)).toBe(0);
    });

    it('writeFile text round-trip unchanged', async () => {
      const res = await fileOps.writeFile(PROJECT, FEATURE, 'docs/readme.md', '# hi', USER_CTX);
      expect(res.content).toBe('# hi');
    });

    it('BinaryFileOperationError carries the machine-readable code', () => {
      const e = new BinaryFileOperationError('BINARY_FILE', 'a/b.glb', 123);
      expect(e.code).toBe('BINARY_FILE');
      expect(e.size).toBe(123);
    });

    it('uploadFiles (Buffer core) round-trips a GLB byte-identically', async () => {
      const glb = makeValidGlb();
      await fileOps.uploadFiles(PROJECT, FEATURE, [{ path: 'assets/game/models/Up.glb', content: glb }], USER_CTX);
      const onDisk = await fs.promises.readFile(path.join(featurePath, 'assets/game/models/Up.glb'));
      expect(Buffer.compare(onDisk, glb)).toBe(0);
    });
  });
});
