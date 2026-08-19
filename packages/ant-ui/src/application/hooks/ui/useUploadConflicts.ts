/**
 * Conflict-checked upload — the single owner of "does this name already exist
 * in the target directory, and what did the user choose about it".
 * `modalProps` spread straight into <UploadConflictModal />.
 *
 * A caller with one stable tree passes it once (`tree`); a caller whose tree
 * depends on the target (which agent's definition dir) passes it per request,
 * along with any context `upload` needs — both travel with the pending
 * decision, so nothing is read from a later render.
 */

import { useCallback, useState } from 'react';
import type { FileNode } from '@ant/shared';
import type { UploadFileEntry } from '@/infrastructure/http/api/files';
import type { ConflictResolution } from '@/presentation/components/common/UploadConflictModal';
import { applyPerFileResolutions, findConflicts, getAllExistingNames } from '@/shared/utils/upload-utils';

export interface UploadRequestContext {
  tree?: FileNode[] | null;
  [key: string]: unknown;
}

export interface UseUploadConflictsOptions<Ctx extends UploadRequestContext> {
  tree?: FileNode[] | null;
  upload: (dirPath: string, entries: UploadFileEntry[], ctx?: Ctx) => void;
  /** Off where a renamed copy would fall outside the target's path contract. */
  allowCopy?: boolean;
  /** Returns true when the mutation is blocked (a warning was already shown). */
  guard?: () => boolean;
}

export function useUploadConflicts<Ctx extends UploadRequestContext = UploadRequestContext>({
  tree,
  upload,
  allowCopy,
  guard,
}: UseUploadConflictsOptions<Ctx>) {
  const [pending, setPending] = useState<{
    isOpen: boolean;
    conflictingFiles: string[];
    dirPath: string;
    entries: UploadFileEntry[];
    tree?: FileNode[] | null;
    ctx?: Ctx;
  }>({ isOpen: false, conflictingFiles: [], dirPath: '', entries: [] });

  const requestUpload = useCallback(
    (dirPath: string, entries: UploadFileEntry[], ctx?: Ctx) => {
      if (guard?.()) return;
      const target = ctx?.tree ?? tree;
      if (!target) {
        upload(dirPath, entries, ctx);
        return;
      }
      const conflicts = findConflicts(target, dirPath, entries);
      if (conflicts.length === 0) {
        upload(dirPath, entries, ctx);
        return;
      }
      setPending({ isOpen: true, conflictingFiles: conflicts, dirPath, entries, tree: target, ctx });
    },
    [tree, upload, guard],
  );

  const onResolve = useCallback(
    (resolution: ConflictResolution) => {
      const { dirPath, entries, tree: target, ctx } = pending;
      setPending((prev) => ({ ...prev, isOpen: false }));
      if (resolution === 'cancel') return;
      const existingNames = target ? getAllExistingNames(target, dirPath) : [];
      upload(dirPath, applyPerFileResolutions(entries, resolution.perFile, existingNames), ctx);
    },
    [pending, upload],
  );

  const close = useCallback(() => setPending((prev) => ({ ...prev, isOpen: false })), []);

  return {
    requestUpload,
    modalProps: {
      isOpen: pending.isOpen,
      conflictingFiles: pending.conflictingFiles,
      onClose: close,
      onResolve,
      allowCopy,
    },
  };
}
