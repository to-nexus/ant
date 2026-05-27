/**
 * enrichActionMetadataWithFolders — fold `ActionMetadata.target/refs/context`
 * into `foldersCompressed` (full-folder selections → single folder entry).
 *
 * The FE `ActionMetadataBadges` renders `foldersCompressed` when present so
 * a 30-file folder collapses to a single `📂 dir/ (N files)` badge instead
 * of 30 individual file badges. BE owns the FS check (`compressPathsByFolder`)
 * because deciding "all files in dir selected" requires reading the actual
 * directory contents — the FE has no view of paths outside the selection.
 *
 * Idempotent: missing `fileSystem` / missing paths / empty result short-
 * circuit and return the input unchanged. Safe to call on every
 * actionMetadata-bearing entry point (chat user-message route + worker
 * `recordUserTurn`).
 */

import type { ActionMetadata } from '@ant/shared';
import type { FileSystemPort } from '../ports/filesystem.js';
import { compressPathsByFolder } from './compressPathsByFolder.js';

export async function enrichActionMetadataWithFolders(
  meta: ActionMetadata | undefined,
  fileSystem: FileSystemPort | undefined,
): Promise<ActionMetadata | undefined> {
  if (!meta) return meta;
  if (!fileSystem) return meta;
  // Already enriched — preserve (caller has a richer FS view than us).
  if (meta.foldersCompressed) return meta;
  const hasAnyPaths = !!(meta.target?.length || meta.refs?.length || meta.context?.length);
  if (!hasAnyPaths) return meta;

  const [target, refs, context] = await Promise.all([
    meta.target?.length ? compressPathsByFolder(meta.target, fileSystem) : Promise.resolve(undefined),
    meta.refs?.length ? compressPathsByFolder(meta.refs, fileSystem) : Promise.resolve(undefined),
    meta.context?.length ? compressPathsByFolder(meta.context, fileSystem) : Promise.resolve(undefined),
  ]);

  if (!target && !refs && !context) return meta;
  return {
    ...meta,
    foldersCompressed: {
      ...(target ? { target } : {}),
      ...(refs ? { refs } : {}),
      ...(context ? { context } : {}),
    },
  };
}
