/**
 * Upload integrity contract — valid-crating-prawn follow-up.
 *
 * The first fix rejected the corrupted Duck.glb but surfaced it as a 500
 * ("Upload error"), which reads as a server fault rather than "your file is
 * damaged". And because the check ran mid-write, a multi-file upload could
 * leave earlier files ingested before the defect was found.
 *
 * Contract locked here:
 *   - a corrupted binary → 422 { code: 'CORRUPTED_FILE', filename }
 *   - validation is all-or-nothing: nothing is written when ANY file is bad
 *   - an intact binary round-trips byte-identically
 *   - the gate applies in directories with NO artifact-dir policy
 *     (`assets/game/models` has no exact-match policy entry)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import http from 'node:http';
import express from 'express';

import { createFilesRoutes } from '../../src/periphery/adapters/http/routes/files.routes';
import { UnifiedWorkspaceResolver } from '../../src/core/config/WorkspacePathResolver';
import { FileOperationService } from '../../src/periphery/adapters/http/services/ProjectService/FileOperationService';

const PROJECT_ID = 'p1';
const FEATURE = 'main';
const ORG = 'o1';
const USER = 'u1';
const DIR = 'assets/game/models';

function makeValidGlb(binPadding = 256): Buffer {
  const json = Buffer.from('{"asset":{"version":"2.0"}} ', 'utf-8');
  const bin = Buffer.alloc(binPadding);
  for (let i = 0; i < binPadding; i++) bin[i] = (i * 37 + 128) % 256;
  const total = 12 + 8 + json.length + bin.length;
  const buf = Buffer.alloc(total);
  buf.write('glTF', 0, 'latin1');
  buf.writeUInt32LE(2, 4);
  buf.writeUInt32LE(total, 8);
  buf.writeUInt32LE(json.length, 12);
  buf.write('JSON', 16, 'latin1');
  json.copy(buf, 20);
  bin.copy(buf, 20 + json.length);
  return buf;
}

/** The exact corruption from the incident. */
function corrupt(buf: Buffer): Buffer {
  return Buffer.from(buf.toString('utf-8'), 'utf-8');
}

describe('POST /upload — binary integrity', () => {
  let tmpWorkspaces: string;
  let featurePath: string;
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    tmpWorkspaces = await fs.mkdtemp(path.join(os.tmpdir(), 'ant-upload-integrity-'));
    const resolver = new UnifiedWorkspaceResolver(tmpWorkspaces);
    const fileOps = new FileOperationService(resolver);
    featurePath = resolver.getFeaturePath(
      { userId: USER, organizationId: ORG } as any,
      PROJECT_ID,
      FEATURE,
    );

    const projectService = {
      readFile: fileOps.readFile.bind(fileOps),
      writeFile: fileOps.writeFile.bind(fileOps),
      resolveExistingFeatureForMutation: async () => featurePath,
      workspaceResolver: resolver,
    } as any;

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).user = { id: USER };
      (req as any).organization = { id: ORG, kind: 'team' };
      next();
    });
    app.use(createFilesRoutes({ projectService }));

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(tmpWorkspaces, { recursive: true, force: true });
  });

  async function upload(entries: Array<{ name: string; bytes: Buffer }>): Promise<Response> {
    const form = new FormData();
    form.append('dirPath', DIR);
    for (const e of entries) {
      form.append('files', new Blob([new Uint8Array(e.bytes)]), e.name);
      form.append('relativePaths', e.name);
    }
    return fetch(`${baseUrl}/projects/${PROJECT_ID}/features/${FEATURE}/upload`, {
      method: 'POST',
      body: form,
    });
  }

  it('accepts an intact GLB byte-identically', async () => {
    const glb = makeValidGlb();
    const res = await upload([{ name: 'Duck.glb', bytes: glb }]);
    expect(res.status).toBe(200);

    const onDisk = await fs.readFile(path.join(featurePath, DIR, 'Duck.glb'));
    expect(Buffer.compare(onDisk, glb)).toBe(0);
  });

  it('rejects the corrupted Duck.glb with 422 CORRUPTED_FILE (not 500)', async () => {
    const res = await upload([{ name: 'Duck.glb', bytes: corrupt(makeValidGlb()) }]);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('CORRUPTED_FILE');
    expect(body.filename).toBe('Duck.glb');
    expect(body.message).toMatch(/corrupted/i);
    expect(existsSync(path.join(featurePath, DIR, 'Duck.glb'))).toBe(false);
  });

  it('all-or-nothing: a late corrupted file leaves the earlier intact one unwritten', async () => {
    const res = await upload([
      { name: 'Good.glb', bytes: makeValidGlb() },
      { name: 'Bad.glb', bytes: corrupt(makeValidGlb()) },
    ]);
    expect(res.status).toBe(422);
    expect(existsSync(path.join(featurePath, DIR, 'Good.glb'))).toBe(false);
    expect(existsSync(path.join(featurePath, DIR, 'Bad.glb'))).toBe(false);
  });

  /**
   * M-NEW-003: the route's `assertWithinRoot` proved `stage` was inside the
   * feature at check time, then the write resolved `stage/payload` by name. A
   * same-workspace preview child that repoints `stage` at a service-writable
   * directory in between landed the upload outside the feature. The write now
   * descends from the feature root.
   */
  it('refuses an upload whose intermediate directory points out of the feature', async () => {
    const outside = path.join(tmpWorkspaces, 'outside-target');
    await fs.mkdir(outside, { recursive: true });
    await fs.mkdir(path.join(featurePath, DIR), { recursive: true });
    await fs.symlink(outside, path.join(featurePath, DIR, 'stage'));

    const form = new FormData();
    form.append('dirPath', DIR);
    form.append('files', new Blob([new Uint8Array(makeValidGlb())]), 'Duck.glb');
    form.append('relativePaths', 'stage/Duck.glb');
    const res = await fetch(`${baseUrl}/projects/${PROJECT_ID}/features/${FEATURE}/upload`, {
      method: 'POST',
      body: form,
    });

    expect(res.status).not.toBe(200);
    expect(existsSync(path.join(outside, 'Duck.glb'))).toBe(false);
  });

  it('overwriting a poisoned pool file with the intact original succeeds', async () => {
    const dest = path.join(featurePath, DIR, 'Duck.glb');
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, corrupt(makeValidGlb()));

    const good = makeValidGlb();
    const res = await upload([{ name: 'Duck.glb', bytes: good }]);
    expect(res.status).toBe(200);
    expect(Buffer.compare(await fs.readFile(dest), good)).toBe(0);
  });

  /**
   * M-NEW-029 (audit-9 residual): the reserved `sessions/**` verdict was taken
   * on `dirPath` only, so a part's own `relativePaths[]` could climb out of an
   * innocuous directory and land on job-lifecycle state — the one mutation
   * source the PUT/directory/rename guards did not cover. The verdict now runs
   * on each part's RESOLVED feature-relative target.
   */
  describe('reserved sessions/** namespace', () => {
    async function uploadRaw(fields: Array<[string, string]>, filename: string): Promise<Response> {
      const form = new FormData();
      for (const [k, v] of fields) form.append(k, v);
      form.append('files', new Blob([new Uint8Array(Buffer.from('{"state":{}}'))]), filename);
      return fetch(`${baseUrl}/projects/${PROJECT_ID}/features/${FEATURE}/upload`, {
        method: 'POST',
        body: form,
      });
    }

    // A part that climbs OUT of `dirPath` is already refused by the baseDir
    // anchor (400). Pinned so that anchor cannot be relaxed without noticing.
    it('a relativePaths[] climbing out of dirPath is refused by the baseDir anchor', async () => {
      const res = await uploadRaw(
        [['dirPath', 'plan'], ['relativePaths', '../sessions/architect/code.json']],
        'code.json',
      );
      expect(res.status).toBe(400);
      expect(existsSync(path.join(featurePath, 'sessions', 'architect', 'code.json'))).toBe(false);
    });

    it('refuses a dirPath-less relativePaths[] aimed straight at sessions/**', async () => {
      const res = await uploadRaw(
        [['dirPath', ''], ['relativePaths', 'sessions/architect/code.json']],
        'code.json',
      );
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe('reserved-name-sessions');
      expect(existsSync(path.join(featurePath, 'sessions', 'architect', 'code.json'))).toBe(false);
    });

    it('still refuses the plain dirPath aim (the pre-existing fast path)', async () => {
      const res = await uploadRaw(
        [['dirPath', 'sessions/architect'], ['relativePaths', 'code.json']],
        'code.json',
      );
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe('reserved-name-sessions');
      expect(existsSync(path.join(featurePath, 'sessions', 'architect', 'code.json'))).toBe(false);
    });

    it('refuses a nested dirPath that itself climbs into sessions/**', async () => {
      const res = await uploadRaw(
        [['dirPath', 'plan/../sessions/architect'], ['relativePaths', 'code.json']],
        'code.json',
      );
      expect(res.status).toBe(409);
      expect(existsSync(path.join(featurePath, 'sessions', 'architect', 'code.json'))).toBe(false);
    });

    it('all-or-nothing: a legitimate sibling part is not written either', async () => {
      const form = new FormData();
      form.append('dirPath', '');
      form.append('files', new Blob([new Uint8Array(Buffer.from('# ok'))]), 'ok.md');
      form.append('relativePaths', 'plan/ok.md');
      form.append('files', new Blob([new Uint8Array(Buffer.from('{}'))]), 'code.json');
      form.append('relativePaths', 'sessions/architect/code.json');
      const res = await fetch(`${baseUrl}/projects/${PROJECT_ID}/features/${FEATURE}/upload`, {
        method: 'POST',
        body: form,
      });
      expect(res.status).toBe(409);
      expect(existsSync(path.join(featurePath, 'plan', 'ok.md'))).toBe(false);
      expect(existsSync(path.join(featurePath, 'sessions', 'architect', 'code.json'))).toBe(false);
    });

    it('a normal artifact upload is unaffected', async () => {
      const res = await uploadRaw([['dirPath', 'plan'], ['relativePaths', 'notes.md']], 'notes.md');
      expect(res.status).toBe(200);
      expect(existsSync(path.join(featurePath, 'plan', 'notes.md'))).toBe(true);
    });
  });
});
