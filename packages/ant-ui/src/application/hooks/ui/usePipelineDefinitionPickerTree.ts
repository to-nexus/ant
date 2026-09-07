import { useEffect, useMemo } from 'react';
import { PIPELINE_FILE_NAME, UNIVERSAL_PIPELINES_DIRNAME } from '@ant/shared';
import type { PipelineListEntry } from '@ant/shared';
import { useStore } from '@/domain/store';
import type { FileNode } from '@/infrastructure/http/api';

/**
 * The `_pipelines` subtree the universal `@ctx:` picker browses — pipeline
 * DEFINITIONS, grafted client-side as the `_agents` twin.
 *
 * Definitions are account-scoped templates outside the project, so they are
 * absent from the project file-tree endpoint for the same cache reason the
 * agent definitions are. The source is the pipeline slice's own list (one read
 * owner with the Pipelines tab). Each pipeline is one `pipeline.yaml` node —
 * the splitter the agent plane resolves with (`parseUniversalPipelineRef`)
 * admits nothing else, so `owner.json` / `availability.json` are never built.
 */

/** Scope suffix on the row — a shared org pipeline should not read as yours. */
function pipelineRowName(entry: PipelineListEntry): string {
  return entry.scope === 'org' ? `${entry.name} · org` : entry.name;
}

export function buildPipelinesNode(pipelines: readonly PipelineListEntry[], label: string): FileNode | null {
  if (pipelines.length === 0) return null;
  return {
    name: label,
    path: UNIVERSAL_PIPELINES_DIRNAME,
    type: 'directory',
    children: pipelines.map((entry): FileNode => {
      const prefix = `${UNIVERSAL_PIPELINES_DIRNAME}/${entry.id}`;
      return {
        name: pipelineRowName(entry),
        path: prefix,
        type: 'directory',
        children: [{ name: PIPELINE_FILE_NAME, path: `${prefix}/${PIPELINE_FILE_NAME}`, type: 'file' }],
      };
    }),
  };
}

/**
 * Live `_pipelines` node for the current universal project. Returns null on
 * canonical projects, when disabled by the caller, and when the account has no
 * pipelines. Fetches the list once; a disabled caller never fetches.
 */
export function usePipelineDefinitionPickerTree(label: string, enabled = true): FileNode | null {
  const projectType = useStore(s => s.projectType);
  const pipelines = useStore(s => s.pipelines);
  const ensurePipelinesLoaded = useStore(s => s.ensurePipelinesLoaded);
  const active = enabled && projectType === 'universal';

  useEffect(() => {
    if (active) void ensurePipelinesLoaded();
  }, [active, ensurePipelinesLoaded]);

  return useMemo(() => (active ? buildPipelinesNode(pipelines, label) : null), [active, pipelines, label]);
}
