/**
 * `pickPipelineImport` — folder/file pick → the one file a pipeline definition
 * is made of, plus what rode along.
 *
 * A pipeline definition is `pipeline.yaml` and nothing else, so this table is
 * where "everything else is ignored, and SAID to be ignored" is pinned: a
 * silent drop is what makes a user think the upload lost their work.
 */

import { describe, it, expect } from 'vitest';
import { pickPipelineImport } from '../../src/presentation/components/Pipelines/pipelineImport';
import type { UploadFileEntry } from '../../src/infrastructure/http/api/files';

const entries = (paths: string[]): UploadFileEntry[] =>
  paths.map((p) => ({ file: new File(['x'], p.split('/').pop()!), relativePath: p }));

describe('pickPipelineImport', () => {
  it('a folder pick: the folder name is the id and pipeline.yaml is the definition', () => {
    const picked = pickPipelineImport(entries(['weekly/pipeline.yaml']));
    expect(picked).toMatchObject({ ok: true, id: 'weekly', ignored: [] });
  });

  it('sidecars and prose ride along and are REPORTED, never silently dropped', () => {
    const picked = pickPipelineImport(
      entries(['weekly/pipeline.yaml', 'weekly/availability.json', 'weekly/README.md', 'weekly/docs/notes.md']),
    );
    expect(picked.ok).toBe(true);
    if (!picked.ok) return;
    expect(picked.id).toBe('weekly');
    expect(picked.ignored.sort()).toEqual(['README.md', 'availability.json', 'docs/notes.md']);
  });

  it('a bare pipeline.yaml carries no id — the server slugs def.name', () => {
    const picked = pickPipelineImport(entries(['pipeline.yaml']));
    expect(picked).toMatchObject({ ok: true, ignored: [] });
    if (!picked.ok) return;
    expect(picked.id).toBeUndefined();
  });

  it('a single differently-named yaml is still unambiguous', () => {
    const picked = pickPipelineImport(entries(['my-pipeline.yml']));
    expect(picked.ok).toBe(true);
    if (!picked.ok) return;
    expect(picked.id).toBeUndefined();
  });

  it('pipeline.yaml wins outright when several yaml files are picked', () => {
    const picked = pickPipelineImport(entries(['other.yaml', 'pipeline.yaml']));
    expect(picked.ok).toBe(true);
    if (!picked.ok) return;
    expect(picked.ignored).toEqual(['other.yaml']);
  });

  it('two top-level folders are ambiguous', () => {
    expect(pickPipelineImport(entries(['a/pipeline.yaml', 'b/pipeline.yaml']))).toEqual({
      ok: false,
      reason: 'ambiguous-folder',
    });
  });

  it('several loose yaml files with no pipeline.yaml are ambiguous', () => {
    expect(pickPipelineImport(entries(['a.yaml', 'b.yaml']))).toEqual({
      ok: false,
      reason: 'ambiguous-folder',
    });
  });

  it('the folder name IS the id, so a non-id folder name is refused up front', () => {
    expect(pickPipelineImport(entries(['주간 리포트/pipeline.yaml']))).toEqual({
      ok: false,
      reason: 'bad-folder-name',
    });
  });

  it('a folder with no pipeline.yaml is refused — an agent folder is not a pipeline', () => {
    expect(pickPipelineImport(entries(['research/agent.yaml', 'research/base/system.md']))).toEqual({
      ok: false,
      reason: 'no-yaml',
    });
  });

  it('an empty pick is refused rather than sent as a blank definition', () => {
    expect(pickPipelineImport([])).toEqual({ ok: false, reason: 'no-yaml' });
  });
});
