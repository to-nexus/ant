/**
 * delete_file handler — context-injected version
 */

import type { ToolExecutionContext, ToolResult, ToolSideEffect } from '../types';
import { resolveToolPath, prependFixMessage } from './pathResolver';
import { rejectCodebaseMutate, shouldRejectCodebaseMutate } from './codebaseGate';
import {
  isDepManifestPath,
  DEP_MANIFEST_INSTALL_HINT,
} from './invalidationScope';

export async function handleDeleteFile(
  ctx: ToolExecutionContext,
  args: { path: string },
): Promise<ToolResult> {
  const { path: filePath } = args;
  const fileSystem = ctx.fileSystem;

  try {
    const resolved = await resolveToolPath(ctx, filePath);
    console.log(`[deleteFile] Deleting file: ${resolved.displayPath} (fsPath: ${resolved.fsPath}, scope: ${resolved.scope})`);

    if (shouldRejectCodebaseMutate(ctx, resolved)) {
      return rejectCodebaseMutate('delete_file', resolved);
    }

    const exists = await fileSystem.fileExists(resolved.fsPath);
    if (!exists) {
      const errorMsg = `File does not exist: ${resolved.displayPath}`;
      return { content: errorMsg, error: errorMsg };
    }

    await fileSystem.deleteFile(resolved.fsPath);
    console.log(`[deleteFile] ✅ Deleted: ${resolved.displayPath}`);

    await ctx.chatStatus.completeFileDeletion(resolved.displayPath);
    ctx.recordFileTouch?.('delete', resolved.displayPath);

    if (ctx.fileTreeUpdate && ctx.project && ctx.featureFolder) {
      await ctx.fileTreeUpdate.notifyFileTreeUpdate(ctx.project, ctx.featureFolder);
    }

    const sideEffects: ToolSideEffect[] = [
      { type: 'fileDeleted', path: resolved.displayPath },
    ];

    const manifestSuffix = isDepManifestPath(resolved.displayPath) ? DEP_MANIFEST_INSTALL_HINT : '';
    return {
      content: prependFixMessage(resolved, `File deleted successfully: ${resolved.displayPath}${manifestSuffix}`),
      sideEffects,
    };
  } catch (e) {
    const errorMsg = (e as Error).message;
    console.error(`[deleteFile] ❌ Error:`, errorMsg);
    return { content: `Error: ${errorMsg}`, error: errorMsg };
  }
}
