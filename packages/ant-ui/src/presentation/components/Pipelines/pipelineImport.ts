/**
 * Folder/file pick → the ONE file a pipeline definition is made of.
 *
 * A pipeline definition is `pipeline.yaml` and nothing else: `owner.json` is
 * authorship, `availability.json` is operational state, and there is no prose
 * file at all (a step's instruction is a `directive` string inside the yaml).
 * So an upload here is a single-file decision wearing a folder's clothes, and
 * everything else that rode along is REPORTED as ignored rather than silently
 * dropped — a user who put a README beside the definition should be told it
 * played no part.
 */

import { PIPELINE_FILE_NAME, isValidCustomId } from '@ant/shared';
import type { UploadFileEntry } from '@/infrastructure/http/api/files';
import { normalizeRelativePath } from '@/shared/utils/upload-utils';

export type PipelinePickFailure =
  | 'no-yaml'
  | 'ambiguous-folder'
  | 'bad-folder-name';

export type PipelinePick =
  | {
      ok: true;
      /** Folder pick → the folder name IS the id. File pick → the server slugs `def.name`. */
      id?: string;
      file: File;
      /** Everything that is not the definition, relative to the pick. */
      ignored: string[];
    }
  | { ok: false; reason: PipelinePickFailure };

export function pickPipelineImport(entries: UploadFileEntry[]): PipelinePick {
  const normalized = entries
    .map((e) => ({ entry: e, rel: normalizeRelativePath(e.relativePath) }))
    .filter((e) => e.rel.length > 0);
  if (normalized.length === 0) return { ok: false, reason: 'no-yaml' };

  const tops = new Set(normalized.map((e) => e.rel.split('/')[0]));
  const isFolderPick = normalized.some((e) => e.rel.includes('/'));

  if (!isFolderPick) {
    // Bare file(s): accept exactly one yaml and let the server derive the id.
    const yamls = normalized.filter((e) => isYaml(e.rel));
    if (yamls.length === 0) return { ok: false, reason: 'no-yaml' };
    // `pipeline.yaml` wins outright; otherwise a lone yaml is unambiguous.
    const chosen = yamls.find((e) => e.rel === PIPELINE_FILE_NAME) ?? (yamls.length === 1 ? yamls[0] : null);
    if (!chosen) return { ok: false, reason: 'ambiguous-folder' };
    return {
      ok: true,
      file: chosen.entry.file,
      ignored: normalized.filter((e) => e !== chosen).map((e) => e.rel),
    };
  }

  if (tops.size !== 1) return { ok: false, reason: 'ambiguous-folder' };
  const folder = [...tops][0];
  if (!isValidCustomId(folder)) return { ok: false, reason: 'bad-folder-name' };

  const defEntry = normalized.find((e) => e.rel === `${folder}/${PIPELINE_FILE_NAME}`);
  if (!defEntry) return { ok: false, reason: 'no-yaml' };

  return {
    ok: true,
    id: folder,
    file: defEntry.entry.file,
    ignored: normalized
      .filter((e) => e !== defEntry)
      .map((e) => e.rel.slice(folder.length + 1))
      .filter(Boolean),
  };
}

function isYaml(rel: string): boolean {
  return /\.ya?ml$/i.test(rel);
}
