import type { ResolvedArtifact } from '@ant/shared';
import type { HeaviestNodeId } from '@ant/shared';
import { compactArtifacts } from '../artifact/ArtifactPipeline';
import { prepareRacInjection } from '../../agents/architect/graph/code/nodes/decompose/designSelector';

const UNIFORM_THRESHOLD_CHARS = 30_000;

export function applyNodeCompaction(
  artifacts: ResolvedArtifact[],
  node: HeaviestNodeId,
): ResolvedArtifact[] {
  if (artifacts.length === 0) return artifacts;

  if (node === 'decompose') {
    try {
      const rac = prepareRacInjection({ artifacts } as Parameters<typeof prepareRacInjection>[0]);
      return [...rac.refs, ...rac.context];
    } catch {
      // Conservative over-estimate when prepareRacInjection's invariants
      // can't be satisfied by the stub state — never silently zero RAC.
      return compactArtifacts(artifacts, { threshold: UNIFORM_THRESHOLD_CHARS });
    }
  }

  return compactArtifacts(artifacts, { threshold: UNIFORM_THRESHOLD_CHARS });
}
