/**
 * edit_file handler — context-injected version
 *
 * Supports automatic I/O-level retry for stale content conflicts
 * in parallel mode (WorkerFileSystem + SharedFileBuffer).
 */

import type { ToolExecutionContext, ToolResult, ToolSideEffect } from '../types';
import { resolveToolPath, prependFixMessage } from './pathResolver';
import { rejectCodebaseMutate, shouldRejectCodebaseMutate } from './codebaseGate';
import {
  isDepManifestPath,
  DEP_MANIFEST_INSTALL_HINT,
} from './invalidationScope';
import { enforceManifestPinPolicyForWrite } from './manifestPinPolicy';
import { packageManagerMutex } from './runCommand';

const MAX_IO_RETRIES = 3;

export async function handleEditFile(
  ctx: ToolExecutionContext,
  args: { path: string; old_str: string; new_str: string },
): Promise<ToolResult> {
  const { path: filePath, old_str, new_str } = args;
  const fileSystem = ctx.fileSystem;

  if (!filePath || old_str === undefined || new_str === undefined) {
    const msg = 'edit_file requires path, old_str, and new_str';
    return { content: msg, error: msg };
  }

  try {
    const resolved = await resolveToolPath(ctx, filePath);

    if (shouldRejectCodebaseMutate(ctx, resolved)) {
      const rejection = rejectCodebaseMutate('edit_file', resolved);
      await ctx.chatStatus.failFileEdit(filePath, rejection.error);
      return rejection;
    }

    const exists = await fileSystem.fileExists(resolved.fsPath);
    if (!exists) {
      const msg = `File does not exist: ${resolved.displayPath}. Use <file> tag to create new files.`;
      await ctx.chatStatus.failFileEdit(filePath, msg);
      return { content: msg, error: msg };
    }

    const { applySearchReplace } = await import('../../../../core/streaming/strategies/common/EditOperations');
    const { FileConflictError } = await import('../../../architect/graph/code/parallel/WorkerFileSystem');

    let modifiedContent = '';
    let originalContentForCompare = '';

    // Manifest writes share `packageManagerMutex` with `run_command` install
    // guards so the snapshot scan + violation check + actual write are
    // atomic vs. concurrent installs and concurrent manifest writes from
    // sibling workers. Non-manifest writes take the fast path (no mutex,
    // no scan).
    const isManifestEdit = isDepManifestPath(resolved.displayPath);

    const performEditAttempts = async (): Promise<ToolResult | null> => {
      for (let attempt = 0; attempt < MAX_IO_RETRIES; attempt++) {
        const originalContent = await fileSystem.readFile(resolved.fsPath);
        if (!originalContent) {
          const msg = `Failed to read file: ${resolved.displayPath}`;
          await ctx.chatStatus.failFileEdit(filePath, msg);
          return { content: msg, error: msg };
        }
        originalContentForCompare = originalContent;

        try {
          modifiedContent = applySearchReplace(
            originalContent,
            old_str,
            new_str,
            resolved.displayPath,
          );
        } catch (searchError) {
          const msg =
            `${(searchError as Error).message}\n\n` +
            `⚠️ Your old_str does not match the current file.\n` +
            `Action: Call read_file("${resolved.displayPath}") to get current content, then retry edit_file with exact old_str from the read result.`;
          await ctx.chatStatus.failFileEdit(filePath, msg);
          return { content: msg, error: msg };
        }

        if (isManifestEdit) {
          const rejection = await enforceManifestPinPolicyForWrite(
            resolved.displayPath,
            modifiedContent,
            fileSystem.getRootPath(),
            resolved.displayPath,
          );
          if (rejection) {
            const policyMsg = `[Policy] ${rejection.display}`;
            await ctx.chatStatus.failFileEdit(filePath, policyMsg);
            return { content: policyMsg, error: policyMsg };
          }
        }

        try {
          await fileSystem.writeFile(resolved.fsPath, modifiedContent);
          return null;
        } catch (e) {
          if (e instanceof FileConflictError && (e as any).stale && attempt < MAX_IO_RETRIES - 1) {
            console.log(`⚠️ [EditFile] Stale content detected for ${resolved.displayPath}, retrying (attempt ${attempt + 1}/${MAX_IO_RETRIES})`);
            await ctx.chatStatus.showStatus('file_conflict_retry', {
              filePath: resolved.displayPath,
              attempt: attempt + 1,
              maxRetries: MAX_IO_RETRIES,
            });
            continue;
          }
          throw e;
        }
      }
      return null;
    };

    const earlyReturn = isManifestEdit
      ? await packageManagerMutex.runExclusive(performEditAttempts)
      : await performEditAttempts();
    if (earlyReturn) return earlyReturn;

    console.log(`✅ [EditFile] Successfully edited ${resolved.displayPath}`);
    console.log(`   Replaced ${old_str.length} chars with ${new_str.length} chars`);

    await ctx.chatStatus.completeFileEdit(resolved.displayPath, old_str, new_str);
    ctx.recordFileTouch?.('update', resolved.displayPath);

    if (ctx.fileTreeUpdate && ctx.project && ctx.featureFolder) {
      await ctx.fileTreeUpdate.notifyFileTreeUpdate(ctx.project, ctx.featureFolder);
      // Feature-workspace contract: edits under generated-artifact domains
      // (`architecture/`, `visual/`, `meta/evals/`) are surfaced as unseen
      // artifacts in the UI. Path-prefix gate only (no job-type branch) so
      // it stays consistent with `handleCreateFile` and the ingestion paths
      // in `chat.routes.ts` / `transfer.routes.ts`.
      const dp = resolved.displayPath;
      if (
        'addUnseenArtifacts' in ctx.fileTreeUpdate &&
        (dp.startsWith('architecture/') || dp.startsWith('visual/') || dp.startsWith('meta/evals/'))
      ) {
        (ctx.fileTreeUpdate as any).addUnseenArtifacts(
          ctx.project, ctx.featureFolder, [dp]
        );
      }
    }

    // If the edit produced the same content, emit fileNotChanged so the
    // reverify path can safely skip. Treat as a no-op for tracker invalidation.
    const contentChanged = modifiedContent !== originalContentForCompare;
    if (!contentChanged) {
      console.log(`   ℹ️  [EditFile] Content unchanged after edit — emitting fileNotChanged`);
      return {
        content: prependFixMessage(resolved, `File edited (no content change): ${resolved.displayPath}`),
        sideEffects: [{ type: 'fileNotChanged', path: resolved.displayPath }],
      };
    }

    const sideEffects: ToolSideEffect[] = [
      { type: 'fileModified', path: resolved.displayPath },
    ];

    const manifestSuffix = isDepManifestPath(resolved.displayPath) ? DEP_MANIFEST_INSTALL_HINT : '';
    return {
      content: prependFixMessage(resolved, `File edited successfully: ${resolved.displayPath}\nReplaced ${old_str.length} characters with ${new_str.length} characters.${manifestSuffix}`),
      sideEffects,
    };
  } catch (e) {
    const errorMsg = (e as Error).message;
    await ctx.chatStatus.failFileEdit(filePath, errorMsg);
    return { content: `Error: ${errorMsg}`, error: errorMsg };
  }
}
