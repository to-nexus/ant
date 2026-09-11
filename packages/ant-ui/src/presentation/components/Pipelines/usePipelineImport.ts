/**
 * Pipeline definition import — picker, drop, overwrite prompt, result.
 *
 * The collision verdict is the SERVER's 409 `pipeline-exists`, never a local
 * list lookup: the agent screen learned that the hard way, where a stale list
 * turned the overwrite prompt into a silent no-op. A drop on a row supplies a
 * target id up front, but that is a convenience — the 409 still drives the
 * prompt when the id came from the folder name instead.
 */

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import { ApiError } from '@/infrastructure/http/api/client';
import type { UploadFileEntry } from '@/infrastructure/http/api/files';
import { importPipelineDefinition } from '@/infrastructure/http/api/pipelines';
import { useUploadStatus } from '@/application/hooks/ui/useUploadStatus';
import { pickPipelineImport, type PipelinePickFailure } from './pipelineImport';

interface PendingOverwrite {
  yaml: string;
  id: string;
  ignored: string[];
}

export function usePipelineImport() {
  const { t } = useTranslation('pipelines');
  const loadPipelines = useStore((s) => s.loadPipelines);
  const selectPipeline = useStore((s) => s.selectPipeline);
  const upload = useUploadStatus();
  const [pendingOverwrite, setPendingOverwrite] = useState<PendingOverwrite | null>(null);

  const send = useCallback(
    async (args: { yaml: string; id?: string; overwrite?: boolean; ignored: string[] }) => {
      // One small file: the card reports the ACT, not a byte ratio, and there
      // is nothing to abort between batches — the rail wires X to dismiss.
      upload.begin(1, args.id ?? '');
      try {
        const result = await importPipelineDefinition({
          yaml: args.yaml,
          id: args.id,
          overwrite: args.overwrite,
        });
        await loadPipelines();
        await selectPipeline(result.id);
        const base = result.created
          ? t('import.created', 'Pipeline "{{id}}" imported', { id: result.id })
          : t('import.replaced', 'Pipeline "{{id}}" replaced', { id: result.id });
        // Files that rode along are named, never silently dropped — a README
        // beside the definition played no part and the user should know.
        const ignoredNote =
          args.ignored.length > 0
            ? ` ${t('import.ignored', '({{count}} file(s) ignored — not part of a pipeline definition)', {
                count: args.ignored.length,
              })}`
            : '';
        upload.finish(base + ignoredNote, args.ignored.length > 0 ? 'warning' : 'success');
        return result;
      } catch (e) {
        upload.fail();
        throw e;
      }
    },
    [upload, loadPipelines, selectPipeline, t],
  );

  const submitEntries = useCallback(
    async (entries: UploadFileEntry[], targetId?: string) => {
      const picked = pickPipelineImport(entries);
      if (!picked.ok) {
        upload.showNotice(failureMessage(picked.reason, t));
        return;
      }
      let text: string;
      try {
        text = await picked.file.text();
      } catch {
        upload.showNotice(t('import.unreadable', 'Could not read the uploaded file.'));
        return;
      }
      // A row drop names the pipeline it landed on; a rail drop leaves the id
      // to the folder name, and a bare file leaves it to the server's slug.
      const id = targetId ?? picked.id;
      try {
        await send({ yaml: text, id, ignored: picked.ignored });
      } catch (e) {
        if (e instanceof ApiError && e.code === 'pipeline-exists') {
          const existingId = e.conflictId ?? id;
          if (existingId) {
            setPendingOverwrite({ yaml: text, id: existingId, ignored: picked.ignored });
            return;
          }
        }
        upload.showNotice(e instanceof Error ? e.message : String(e));
      }
    },
    [send, upload, t],
  );

  const resolveOverwrite = useCallback(
    async (confirmed: boolean) => {
      const target = pendingOverwrite;
      setPendingOverwrite(null);
      if (!confirmed || !target) return;
      try {
        await send({ yaml: target.yaml, id: target.id, overwrite: true, ignored: target.ignored });
      } catch (e) {
        upload.showNotice(e instanceof Error ? e.message : String(e));
      }
    },
    [pendingOverwrite, send, upload],
  );

  return { upload, submitEntries, pendingOverwrite, resolveOverwrite };
}

function failureMessage(
  reason: PipelinePickFailure,
  t: (key: string, fallback: string) => string,
): string {
  switch (reason) {
    case 'no-yaml':
      return t('import.noYaml', 'No pipeline.yaml in the upload — a pipeline definition is that one file.');
    case 'ambiguous-folder':
      return t('import.ambiguous', 'Upload exactly one pipeline folder, or one pipeline.yaml.');
    case 'bad-folder-name':
      return t('import.badFolderName', 'The folder name is the pipeline id — use [a-z0-9-] only.');
  }
}
