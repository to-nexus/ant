/**
 * loadDocumentsForRAC — RAC-driven document loader
 *
 * Loads file contents for paths listed in RAC.refs[] and RAC.context[],
 * assigning document roles based on array membership.
 * Replaces per-job inline loading + _pendingDocuments pattern.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ResolvedActionContext, ResolvedDocument } from '@ant/shared';
import { normalizeTemplateDoc } from '../../../core/utils/templateDetector';

/**
 * Load documents from disk based on RAC refs/context paths.
 * Files in refs[] get role='ref', files in context[] get role='context'.
 * Template-only files are filtered out via normalizeTemplateDoc.
 *
 * @returns Documents array (may be empty if no paths or all files missing).
 */
export function loadDocumentsForRAC(
  resolvedAction: ResolvedActionContext,
  featurePath: string,
): ResolvedDocument[] {
  const docs: ResolvedDocument[] = [];

  for (const refPath of resolvedAction.refs ?? []) {
    const content = readFeatureFile(featurePath, refPath);
    if (content) {
      docs.push({ path: refPath, content, role: 'ref' });
    }
  }

  for (const ctxPath of resolvedAction.context ?? []) {
    const content = readFeatureFile(featurePath, ctxPath);
    if (content) {
      docs.push({ path: ctxPath, content, role: 'context' });
    }
  }

  return docs;
}

/**
 * Merge loaded documents into a RAC, returning a new RAC with documents populated.
 * Deduplicates by path — if a document with the same path already exists, it is not added again.
 */
export function mergeDocumentsIntoRAC(
  resolvedAction: ResolvedActionContext,
  featurePath: string,
): ResolvedActionContext {
  const newDocs = loadDocumentsForRAC(resolvedAction, featurePath);
  if (newDocs.length === 0) return resolvedAction;

  const existing = resolvedAction.documents ?? [];
  const existingPaths = new Set(existing.map(d => d.path));
  const deduped = newDocs.filter(d => !existingPaths.has(d.path));
  if (deduped.length === 0) return resolvedAction;

  return {
    ...resolvedAction,
    documents: [...existing, ...deduped],
  };
}

function readFeatureFile(featurePath: string, relativePath: string): string | null {
  try {
    const raw = fs.readFileSync(path.join(featurePath, relativePath), 'utf-8');
    return normalizeTemplateDoc(raw);
  } catch {
    return null;
  }
}
