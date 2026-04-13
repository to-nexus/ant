/**
 * loadResolvedArtifacts — Load file contents for RAC file slots
 *
 * Loads file contents for paths listed in RAC.refs[] and RAC.context[],
 * assigning artifact roles based on array membership.
 * Returns ResolvedArtifact[] to be stored on state.resolvedArtifacts (NOT in RAC).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ResolvedActionContext, ResolvedArtifact } from '@ant/shared';
import { normalizeTemplateDoc } from '../../../core/utils/templateDetector';

/**
 * Load artifacts from disk based on RAC refs/context paths.
 * Files in refs[] get role='ref', files in context[] get role='context'.
 * Template-only files are filtered out via normalizeTemplateDoc.
 */
export function loadResolvedArtifacts(
  resolvedAction: ResolvedActionContext,
  featurePath: string,
): ResolvedArtifact[] {
  const artifacts: ResolvedArtifact[] = [];

  for (const refPath of resolvedAction.refs ?? []) {
    const content = readFeatureFile(featurePath, refPath);
    if (content) {
      artifacts.push({ path: refPath, content, role: 'ref' });
    }
  }

  for (const ctxPath of resolvedAction.context ?? []) {
    const content = readFeatureFile(featurePath, ctxPath);
    if (content) {
      artifacts.push({ path: ctxPath, content, role: 'context' });
    }
  }

  return artifacts;
}


function readFeatureFile(featurePath: string, relativePath: string): string | null {
  try {
    const raw = fs.readFileSync(path.join(featurePath, relativePath), 'utf-8');
    return normalizeTemplateDoc(raw);
  } catch {
    return null;
  }
}
