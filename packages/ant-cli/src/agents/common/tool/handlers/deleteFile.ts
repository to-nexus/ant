/**
 * delete_file handler — context-injected version
 */

import type { ToolExecutionContext, ToolResult, ToolSideEffect } from '../types';
import { resolveToolPath, prependFixMessage } from './pathResolver';
import { decideInvalidationScope } from './invalidationScope';

export async function handleDeleteFile(
  ctx: ToolExecutionContext,
  args: { path: string },
): Promise<ToolResult> {
  const { path: filePath } = args;
  const fileSystem = ctx.fileSystem;

  try {
    const resolved = await resolveToolPath(ctx, filePath);
    console.log(`[deleteFile] Deleting file: ${resolved.displayPath} (fsPath: ${resolved.fsPath}, scope: ${resolved.scope})`);

    const exists = await fileSystem.fileExists(resolved.fsPath);
    if (!exists) {
      const errorMsg = `File does not exist: ${resolved.displayPath}`;
      return { content: errorMsg, error: errorMsg };
    }

    await fileSystem.deleteFile(resolved.fsPath);
    console.log(`[deleteFile] ✅ Deleted: ${resolved.displayPath}`);

    await ctx.chatStatus.completeFileDeletion(resolved.displayPath);

    if (ctx.fileTreeUpdate && ctx.project && ctx.featureFolder) {
      await ctx.fileTreeUpdate.notifyFileTreeUpdate(ctx.project, ctx.featureFolder);
    }

    const decision = decideInvalidationScope(resolved.displayPath);
    const sideEffects: ToolSideEffect[] = [
      { type: 'fileDeleted', path: resolved.displayPath },
      {
        type: 'verificationInvalidated',
        scope: decision.scope,
        reason: decision.reason,
      },
    ];

    return {
      content: prependFixMessage(resolved, `File deleted successfully: ${resolved.displayPath}`),
      sideEffects,
    };
  } catch (e) {
    const errorMsg = (e as Error).message;
    console.error(`[deleteFile] ❌ Error:`, errorMsg);
    return { content: `Error: ${errorMsg}`, error: errorMsg };
  }
}
