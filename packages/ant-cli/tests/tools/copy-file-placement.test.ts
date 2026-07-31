/**
 * copy_file — byte-faithful asset placement (level-dashing-plumb RCA).
 *
 * Before this tool the code job had NO way to place a binary file. Every
 * authoring surface funnels through `FileSystemAdapter.writeFile(content: string)`
 * and writes utf-8, so `.glb` targets are hard-refused there, and the byte-safe
 * SSOT (`writeBufferVerified`) was reachable only from the HTTP upload routes and
 * design's `download_asset`. The plan phase could declare the placement via
 * `implementation.assets[]` and nothing could carry it out.
 *
 * Registration alone is not enough: an unadvertised tool goes unused, so the
 * advertisement surfaces are asserted here too.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';
import { handleCopyFile } from '../../src/agents/common/tool/handlers/copyFile';
import { FileSystemAdapter } from '../../src/periphery/adapters/filesystem/FileSystemAdapter';
import type { ToolExecutionContext } from '../../src/agents/common/tool/types';
import { ToolName, JOB_TOOL_MATRIX, JobType, TOOL_SETS, TOOL_HANDLERS } from '../../src/agents/common/tool/toolCatalog';
import { createCodeToolRegistry } from '../../src/agents/common/tool/presets';
import { ARCHITECT_TOOLS } from '../../src/agents/common/tool/toolSchemas';

function makeCtx(workspacePath: string): ToolExecutionContext {
  const noop = async () => undefined as any;
  return {
    fileSystem: new FileSystemAdapter(workspacePath),
    chatStatus: new Proxy({}, { get: () => noop }) as ToolExecutionContext['chatStatus'],
    workingDir: workspacePath,
    // execute phase — codebase/ writes permitted
    allowMutateInCodebase: true,
  } as ToolExecutionContext;
}

/** A minimal VALID .glb: 'glTF' magic + version + declared length == byte length. */
function makeGlb(payloadSize: number): Buffer {
  const total = 12 + payloadSize;
  const buf = Buffer.alloc(total);
  buf.write('glTF', 0, 'latin1');
  buf.writeUInt32LE(2, 4);
  buf.writeUInt32LE(total, 8);
  for (let i = 12; i < total; i++) buf[i] = i % 251;
  return buf;
}

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

let ws: string;

beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-copy-file-'));
});

afterEach(() => {
  if (ws) fs.rmSync(ws, { recursive: true, force: true });
});

describe('handleCopyFile — byte fidelity', () => {
  it('places a binary asset byte-for-byte and creates parent directories', async () => {
    const src = makeGlb(4096);
    fs.mkdirSync(path.join(ws, 'assets/game/models'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'assets/game/models/Duck.glb'), src);

    const result = await handleCopyFile(makeCtx(ws), {
      source: 'assets/game/models/Duck.glb',
      destination: 'codebase/public/models/Duck.glb',
    });

    expect(result.error).toBeUndefined();
    const written = fs.readFileSync(path.join(ws, 'codebase/public/models/Duck.glb'));
    expect(sha(written)).toBe(sha(src));
    expect(written.length).toBe(src.length);
  });

  it('overwrites a corrupted destination with the healthy source — the incident scenario', async () => {
    // Mirrors the real workspace: healthy 120KB source, corrupted 198KB target.
    const healthy = makeGlb(1024);
    fs.mkdirSync(path.join(ws, 'assets/game/models'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'assets/game/models/Duck.glb'), healthy);

    // A utf-8 round-trip victim: U+FFFD-saturated and larger than declared.
    const mojibake = Buffer.concat([
      Buffer.from('glTF', 'latin1'),
      Buffer.alloc(8),
      Buffer.from('efbfbd'.repeat(400), 'hex'),
    ]);
    fs.mkdirSync(path.join(ws, 'codebase/public/models'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'codebase/public/models/Duck.glb'), mojibake);

    const result = await handleCopyFile(makeCtx(ws), {
      source: 'assets/game/models/Duck.glb',
      destination: 'codebase/public/models/Duck.glb',
    });

    expect(result.error).toBeUndefined();
    expect(result.content).toContain('Replaced');
    const written = fs.readFileSync(path.join(ws, 'codebase/public/models/Duck.glb'));
    expect(sha(written)).toBe(sha(healthy));
  });

  it('reports the write as a file side effect so it counts toward filesWritten', async () => {
    fs.mkdirSync(path.join(ws, 'assets/game/models'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'assets/game/models/a.glb'), makeGlb(64));

    const fresh = await handleCopyFile(makeCtx(ws), {
      source: 'assets/game/models/a.glb',
      destination: 'codebase/public/a.glb',
    });
    expect(fresh.sideEffects).toEqual([{ type: 'fileCreated', path: 'codebase/public/a.glb' }]);

    const again = await handleCopyFile(makeCtx(ws), {
      source: 'assets/game/models/a.glb',
      destination: 'codebase/public/a.glb',
    });
    expect(again.sideEffects).toEqual([{ type: 'fileModified', path: 'codebase/public/a.glb' }]);
  });

  it('does NOT rewrite an asset-pool source path into codebase/', async () => {
    fs.mkdirSync(path.join(ws, 'assets/service/icons'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'assets/service/icons/logo.svg'), '<svg/>');

    const result = await handleCopyFile(makeCtx(ws), {
      source: 'assets/service/icons/logo.svg',
      destination: 'codebase/public/logo.svg',
    });

    expect(result.error).toBeUndefined();
    expect(fs.readFileSync(path.join(ws, 'codebase/public/logo.svg'), 'utf-8')).toBe('<svg/>');
  });
});

describe('handleCopyFile — refusals', () => {
  it('refuses a CORRUPTED source instead of placing it (valid-crating-prawn lesson)', async () => {
    const mojibake = Buffer.concat([
      Buffer.from('glTF', 'latin1'),
      Buffer.alloc(8),
      Buffer.from('efbfbd'.repeat(400), 'hex'),
    ]);
    fs.mkdirSync(path.join(ws, 'assets/game/models'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'assets/game/models/bad.glb'), mojibake);

    const result = await handleCopyFile(makeCtx(ws), {
      source: 'assets/game/models/bad.glb',
      destination: 'codebase/public/bad.glb',
    });

    expect(result.error).toBeDefined();
    expect(result.content).toContain('corrupted');
    // Nothing placed — a bad source must not reach the app.
    expect(fs.existsSync(path.join(ws, 'codebase/public/bad.glb'))).toBe(false);
  });

  it('reports a missing source with a recovery hint, and writes nothing', async () => {
    const result = await handleCopyFile(makeCtx(ws), {
      source: 'assets/game/models/nope.glb',
      destination: 'codebase/public/nope.glb',
    });
    expect(result.error).toBeDefined();
    expect(result.content).toContain('source not found');
    expect(result.content).toContain('list_files');
    expect(fs.existsSync(path.join(ws, 'codebase/public/nope.glb'))).toBe(false);
  });

  it('requires both arguments', async () => {
    const r1 = await handleCopyFile(makeCtx(ws), { source: 'a' });
    expect(r1.error).toBeDefined();
    const r2 = await handleCopyFile(makeCtx(ws), { destination: 'b' });
    expect(r2.error).toBeDefined();
  });

  it('refuses a no-op copy onto itself', async () => {
    fs.mkdirSync(path.join(ws, 'assets/game/models'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'assets/game/models/a.glb'), makeGlb(32));
    const result = await handleCopyFile(makeCtx(ws), {
      source: 'assets/game/models/a.glb',
      destination: 'assets/game/models/a.glb',
    });
    expect(result.error).toBeDefined();
  });

  it('honors the codebase mutate gate in a read-only phase', async () => {
    fs.mkdirSync(path.join(ws, 'assets/game/models'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'assets/game/models/a.glb'), makeGlb(32));
    const ctx = makeCtx(ws);
    (ctx as any).allowMutateInCodebase = false;

    const result = await handleCopyFile(ctx, {
      source: 'assets/game/models/a.glb',
      destination: 'codebase/public/a.glb',
    });
    expect(result.error).toBeDefined();
    expect(result.content).toContain('read-only in this phase');
  });
});

describe('copy_file — reachability and advertisement', () => {
  it('is registered for the code job and resolves to a handler', () => {
    expect(JOB_TOOL_MATRIX[JobType.CODE]).toContain(ToolName.COPY_FILE);
    expect(TOOL_HANDLERS.get(ToolName.COPY_FILE)).toBeTypeOf('function');
    expect(createCodeToolRegistry().has(ToolName.COPY_FILE)).toBe(true);
  });

  it('is advertised to execute but NOT to the read-only plan phase', () => {
    expect(TOOL_SETS.codeBasic).toContain(ToolName.COPY_FILE);
    expect(TOOL_SETS.planExplore).not.toContain(ToolName.COPY_FILE);
  });

  it('has a schema that tells the LLM when to reach for it', () => {
    const def = (ARCHITECT_TOOLS as any)[ToolName.COPY_FILE];
    expect(def, 'copy_file must have a tool definition — the schema description is the primary "when to use" channel').toBeDefined();
    expect(def.input_schema.required).toEqual(['source', 'destination']);
    // Registration without steering is the failure mode this asserts against:
    // the model must learn that binary placement has exactly one legal path.
    expect(def.description.toLowerCase()).toContain('binary');
    for (const rival of ['create_file', 'edit_file']) {
      expect(def.description).toContain(rival);
    }
  });

  it('appears in the architect Decision Rules table — the dispatch surface', () => {
    const rules = fs.readFileSync(
      path.resolve(__dirname, '../../src/core/prompt/templates/agents/architect/rules.md'),
      'utf-8',
    );
    const table = rules.slice(rules.indexOf('### Decision Rules'));
    expect(
      table,
      'The Decision Rules table is where the model picks an action. Without an asset-placement row ' +
        'there is no entry point for "a file must be placed, not authored".',
    ).toContain('copy_file');
  });
});
