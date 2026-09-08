/**
 * Directory-unit upload mapping for agent definitions + the writable-root
 * conflict lookup both the definition tree and the universal artifacts root
 * depend on ('' addresses the tree itself, which has no node).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  entriesUnder,
  findDefinitionNode,
  hasEntry,
  pickedFolderName,
} from '../../src/presentation/components/AgentSettings/definitionUpload';
import {
  PartialUploadError,
  applyPerFileResolutions,
  fileListToEntries,
  findConflicts,
  planUploadBatches,
  runUploadBatches,
  uploadRefusalMessage,
} from '../../src/shared/utils/upload-utils';
import {
  UPLOAD_FILE_MAX_BYTES,
  UPLOAD_MAX_FILES_PER_REQUEST,
  UPLOAD_MAX_SCALAR_FIELDS,
} from '@ant/shared';
import { uploadUniversalArtifacts } from '../../src/infrastructure/http/api/customAgents';

// The BE caps, derived here the same way `UPLOAD_LIMITS` derives them — so a
// request this suite calls conforming is one that multer accepts.
const UPLOAD_LIMITS_FILES = UPLOAD_MAX_FILES_PER_REQUEST;
const UPLOAD_LIMITS_FIELDS = UPLOAD_MAX_FILES_PER_REQUEST + UPLOAD_MAX_SCALAR_FIELDS;
const UPLOAD_LIMITS_PARTS = UPLOAD_MAX_FILES_PER_REQUEST * 2 + UPLOAD_MAX_SCALAR_FIELDS;
import type { FileNode } from '@ant/shared';

function fileList(paths: string[]): FileList {
  const files = paths.map((p) => {
    const file = new File(['x'], p.split('/').pop()!);
    Object.defineProperty(file, 'webkitRelativePath', { value: p });
    return file;
  });
  return { length: files.length, item: (i: number) => files[i] ?? null, ...files } as unknown as FileList;
}

describe('definition folder upload mapping', () => {
  it('the picked folder name is the id, and its segment is stripped', () => {
    const files = fileList(['research/job.yaml', 'research/base/system.md', 'research/intents/a/infer.md']);
    expect(pickedFolderName(files)).toBe('research');
    expect(entriesUnder(files, 'jobs/research').map((e) => e.relativePath)).toEqual([
      'jobs/research/job.yaml',
      'jobs/research/base/system.md',
      'jobs/research/intents/a/infer.md',
    ]);
  });

  it('re-roots under any destination (intent folder into a job)', () => {
    const files = fileList(['triage/infer.md', 'triage/prompt.md']);
    const entries = entriesUnder(files, 'jobs/weekly/intents/triage');
    expect(hasEntry(entries, 'jobs/weekly/intents/triage/infer.md')).toBe(true);
    expect(hasEntry(entries, 'jobs/weekly/intents/triage/job.yaml')).toBe(false);
  });

  it('two top-level folders → no id (the caller must refuse)', () => {
    expect(pickedFolderName(fileList(['a/agent.yaml', 'b/agent.yaml']))).toBeNull();
  });

  it('finds a directory node by path', () => {
    const tree = [
      { name: 'jobs', path: 'jobs', type: 'directory' as const, children: [
        { name: 'weekly', path: 'jobs/weekly', type: 'directory' as const, children: [] },
      ] },
    ];
    expect(findDefinitionNode(tree, 'jobs/weekly')?.name).toBe('weekly');
    expect(findDefinitionNode(tree, 'jobs/other')).toBeUndefined();
  });
});

describe('findConflicts at the tree root', () => {
  const tree: FileNode[] = [
    { name: 'agent.yaml', path: 'agent.yaml', type: 'file' },
    { name: 'base', path: 'base', type: 'directory', children: [] },
  ];

  it("'' addresses the root itself", () => {
    expect(findConflicts(tree, '', [{ file: new File([''], 'agent.yaml'), relativePath: 'agent.yaml' }])).toEqual([
      'agent.yaml',
    ]);
    expect(findConflicts(tree, '', [{ file: new File([''], 'job.yaml'), relativePath: 'job.yaml' }])).toEqual([]);
  });
});

describe('folder picks keep their structure', () => {
  it('webkitRelativePath is the relative path; a bare file falls back to its name', () => {
    expect(fileListToEntries(fileList(['docs/api/spec.md'])).map((e) => e.relativePath)).toEqual([
      'docs/api/spec.md',
    ]);
    const bare = new File(['x'], 'notes.md');
    const list = { length: 1, item: () => bare, 0: bare } as unknown as FileList;
    expect(fileListToEntries(list)[0].relativePath).toBe('notes.md');
  });
});

describe('conflict identity is the relative path, not the file name', () => {
  const tree: FileNode[] = [
    {
      name: 'plan',
      path: 'plan',
      type: 'directory',
      children: [
        { name: 'a.md', path: 'plan/a.md', type: 'file' },
        {
          name: 'docs',
          path: 'plan/docs',
          type: 'directory',
          children: [{ name: 'a.md', path: 'plan/docs/a.md', type: 'file' }],
        },
      ],
    },
  ];
  const entry = (relativePath: string) => ({ file: new File([''], 'a.md'), relativePath });

  it('the same name under a different sub-folder is not a conflict', () => {
    expect(findConflicts(tree, 'plan', [entry('other/a.md')])).toEqual([]);
  });

  it('a nested path that does exist IS a conflict, reported as the full relative path', () => {
    expect(findConflicts(tree, 'plan', [entry('docs/a.md')])).toEqual(['docs/a.md']);
  });

  it('two same-named files in different sub-folders resolve independently', () => {
    const resolved = applyPerFileResolutions(
      [entry('docs/a.md'), entry('other/a.md')],
      { 'docs/a.md': 'copy', 'other/a.md': 'overwrite' },
      ['a.md', 'docs', 'docs/a.md'],
    );
    expect(resolved.map((e) => e.relativePath)).toEqual(['docs/a (1).md', 'other/a.md']);
  });
});


// ── Batching ─────────────────────────────────────────────────────────

/**
 * A folder upload must be split into requests the server accepts.
 *
 * Every lane sends paired parts per file, so an unbatched 115-file drop spent
 * 116 fields against a cap of 50, multer aborted, and — with no MulterError
 * handler — the user got an HTML 500. These rows pin the split, the sequencing
 * the destructive replace lanes depend on, and the partial-failure report.
 */
function entry(relativePath: string, size = 8) {
  const file = new File(['x'], relativePath.split('/').pop()!);
  Object.defineProperty(file, 'size', { value: size });
  return { file, relativePath };
}

describe('upload batching', () => {
  it('splits the reported 115-file folder into full batches plus a remainder', () => {
    const plan = planUploadBatches(Array.from({ length: 115 }, (_, i) => entry(`d/f${i}.md`)));
    expect(plan.batches.map((b) => b.length)).toEqual([50, 50, 15]);
    expect(plan.batches.flat()).toHaveLength(115);
  });

  it('sends the advertised count as exactly one request — the boundary the bug lived on', () => {
    const n = UPLOAD_MAX_FILES_PER_REQUEST;
    expect(planUploadBatches(Array.from({ length: n }, (_, i) => entry(`f${i}.md`))).batches).toHaveLength(1);
    expect(planUploadBatches(Array.from({ length: n + 1 }, (_, i) => entry(`f${i}.md`))).batches).toHaveLength(2);
  });

  it('splits on BYTES before the count cap when files are large', () => {
    // 4 files of 40 MiB: the count cap is nowhere near, only the byte budget bites.
    const plan = planUploadBatches(
      Array.from({ length: 8 }, (_, i) => entry(`f${i}.bin`, 40 * 1024 * 1024)),
      { maxBytes: 100 * 1024 * 1024 },
    );
    expect(plan.batches.length).toBeGreaterThan(1);
    for (const batch of plan.batches) {
      const bytes = batch.reduce((n, e) => n + e.file.size, 0);
      expect(bytes).toBeLessThanOrEqual(100 * 1024 * 1024);
    }
  });

  it('separates entries past the per-file cap instead of sending them', () => {
    const plan = planUploadBatches([
      entry('ok.md', 8),
      entry('huge.bin', UPLOAD_FILE_MAX_BYTES + 1),
    ]);
    expect(plan.oversized.map((e) => e.relativePath)).toEqual(['huge.bin']);
    expect(plan.batches.flat().map((e) => e.relativePath)).toEqual(['ok.md']);
    expect(plan.totalBytes).toBe(8);
  });

  it('pins agent.yaml into the first batch — /import validates it per request', () => {
    const entries = [
      ...Array.from({ length: 60 }, (_, i) => entry(`a/base/f${i}.md`)),
      entry('a/agent.yaml'),
    ];
    const plan = planUploadBatches(entries, { pinFirst: (e) => /(^|\/)agent\.yaml$/.test(e.relativePath) });
    expect(plan.batches[0][0].relativePath).toBe('a/agent.yaml');
  });

  it('a single entry is never split apart, even over the byte budget', () => {
    const plan = planUploadBatches([entry('one.md', 1024)], { maxBytes: 1 });
    expect(plan.batches).toHaveLength(1);
  });

  it('an empty input still makes one request, so the server validates it as before', () => {
    expect(planUploadBatches([]).batches).toEqual([[]]);
  });

  it('an all-oversized input makes NO request — the caller reports it instead', () => {
    // A 400 "No files uploaded" on top of "that file is too large" would be a
    // second, misleading error.
    const plan = planUploadBatches([entry('huge.bin', UPLOAD_FILE_MAX_BYTES + 1)]);
    expect(plan.batches).toEqual([]);
    expect(plan.oversized).toHaveLength(1);
  });
});

describe('upload batch driver', () => {
  const planOf = (n: number) => planUploadBatches(Array.from({ length: n }, (_, i) => entry(`f${i}.md`)));

  it('sends batches in order, marking exactly one as first', async () => {
    const seen: Array<{ index: number; isFirst: boolean; size: number }> = [];
    await runUploadBatches(planOf(115), async (batch, ctx) => {
      seen.push({ index: ctx.index, isFirst: ctx.isFirst, size: batch.length });
    });
    expect(seen.map((s) => s.index)).toEqual([0, 1, 2]);
    expect(seen.filter((s) => s.isFirst)).toHaveLength(1);
    expect(seen[0].isFirst).toBe(true);
  });

  it('carries a destructive field on the FIRST batch only', async () => {
    // The replace lanes rmSync before writing, so a later batch carrying the
    // flag would delete what the earlier ones wrote.
    const fieldsSent: Array<Record<string, string> | undefined> = [];
    await runUploadBatches(planOf(115), async (_batch, ctx) => {
      fieldsSent.push(ctx.isFirst ? { replaceDir: 'intents/x' } : undefined);
    });
    expect(fieldsSent).toEqual([{ replaceDir: 'intents/x' }, undefined, undefined]);
  });

  it('reports progress monotonically, ending at the planned total', async () => {
    const plan = planOf(115);
    const seen: number[] = [];
    await runUploadBatches(
      plan,
      async (_batch, ctx) => { ctx.onBatchProgress(1, 1); },
      { onProgress: (loaded) => seen.push(loaded) },
    );
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(seen[seen.length - 1]).toBe(plan.totalBytes);
  });

  it('stops issuing sends once the signal aborts', async () => {
    const controller = new AbortController();
    let sends = 0;
    await expect(
      runUploadBatches(
        planOf(115),
        async () => { sends++; controller.abort(); },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(sends).toBe(1);
  });

  it('a failure on a LATER batch is a partial upload, not a plain failure', async () => {
    await expect(
      runUploadBatches(planOf(115), async (_batch, ctx) => {
        if (ctx.index === 2) throw new Error('boom');
      }),
    ).rejects.toMatchObject({
      name: 'PartialUploadError',
      uploadedCount: 100,
      totalCount: 115,
    });
  });

  it('a failure on the FIRST batch keeps the original typed error', async () => {
    // Nothing landed, so every existing error path must behave as before.
    const original = Object.assign(new Error('nope'), { code: 'UPLOAD_TOO_MANY_FILES' });
    const err = await runUploadBatches(planOf(115), async () => { throw original; }).catch((e) => e);
    expect(err).toBe(original);
    expect(err).not.toBeInstanceOf(PartialUploadError);
  });
});

describe('upload refusal messages', () => {
  it('maps each server refusal code to a key', () => {
    expect(uploadRefusalMessage({ code: 'UPLOAD_TOO_MANY_FILES', limit: 50 })).toEqual({
      key: 'error.uploadTooManyFiles',
      params: { limit: 50 },
    });
    expect(uploadRefusalMessage({ code: 'UPLOAD_POD_BUSY' })?.key).toBe('error.uploadServerBusy');
    expect(uploadRefusalMessage({ code: 'UPLOAD_MALFORMED' })?.key).toBe('error.uploadMalformed');
    expect(uploadRefusalMessage({ code: 'UPLOAD_CONCURRENCY_LIMIT' })?.key).toBe('error.uploadTooManyInFlight');
  });

  it("maps a proxy's own bodiless 413 rather than leaving it unrenderable", () => {
    // nginx answers 413 with an HTML body and no `code` — the same
    // unmappable-refusal class this seam exists to remove.
    expect(uploadRefusalMessage({ status: 413 })?.key).toBe('error.uploadTooLarge');
  });

  it('leaves anything that is not an upload refusal to the caller', () => {
    expect(uploadRefusalMessage({ status: 500 })).toBeNull();
    expect(uploadRefusalMessage({ code: 'CORRUPTED_FILE', status: 422 })).toBeNull();
  });
});

// ── Wire shape ───────────────────────────────────────────────────────

/**
 * The lane that carried the reported bug, end to end at the request boundary.
 *
 * The isolated `planUploadBatches` rows above prove the split; these prove the
 * API function actually EMITS conforming requests — the step that was missing
 * when a 115-file folder went out as one request with 116 fields against a cap
 * of 50 and came back an HTML 500.
 */
describe('universal artifact upload emits requests the server accepts', () => {
  let originalFetch: typeof fetch;
  let sent: Array<{ files: number; fields: number; parts: number; paths: string[] }>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    sent = [];
    globalThis.fetch = vi.fn(async (_url: any, init: any) => {
      const form = init.body as FormData;
      const files = form.getAll('files');
      const paths = form.getAll('relativePaths').map(String);
      // Fields are every non-file part; `dirPath` is the one scalar here.
      const fields = paths.length + form.getAll('dirPath').length;
      sent.push({ files: files.length, fields, parts: files.length + fields, paths });
      return new Response(
        JSON.stringify({ success: true, uploadedFiles: paths, count: paths.length }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('splits 115 files into requests that each stay inside every cap', async () => {
    const entries = Array.from({ length: 115 }, (_, i) =>
      entry(i % 2 === 0 ? `pipeline/call-map-${i}.md` : `intent/work-${i}.md`),
    );
    const result = await uploadUniversalArtifacts('p1', 'docs', entries);

    expect(sent).toHaveLength(3);
    expect(sent.map((s) => s.files)).toEqual([50, 50, 15]);
    for (const req of sent) {
      expect(req.files).toBeLessThanOrEqual(UPLOAD_LIMITS_FILES);
      expect(req.fields).toBeLessThanOrEqual(UPLOAD_LIMITS_FIELDS);
      expect(req.parts).toBeLessThanOrEqual(UPLOAD_LIMITS_PARTS);
    }

    // Nested paths survive the split — a folder upload is its structure.
    expect(result.count).toBe(115);
    expect(sent.flatMap((s) => s.paths)).toEqual(entries.map((e) => e.relativePath));
  });

  it('sends one request for a folder that already fits', async () => {
    await uploadUniversalArtifacts('p1', 'docs', [entry('a.md'), entry('b.md')]);
    expect(sent).toHaveLength(1);
    expect(sent[0].files).toBe(2);
  });
});
