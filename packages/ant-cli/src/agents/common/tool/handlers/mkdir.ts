/**
 * mkdir handler — context-injected version
 */

import type { ToolExecutionContext, ToolResult } from '../types';
import { resolveToolPath, prependFixMessage } from './pathResolver';
import { rejectCodebaseMutate, shouldRejectCodebaseMutate } from './codebaseGate';

export async function handleMkdir(
  ctx: ToolExecutionContext,
  args: { path: string },
): Promise<ToolResult> {
  const { path: dirPath } = args;
  const fileSystem = ctx.fileSystem;

  try {
    const resolved = await resolveToolPath(ctx, dirPath);
    console.log(`[mkdir] Creating directory: ${resolved.fsPath}`);

    if (shouldRejectCodebaseMutate(ctx, resolved)) {
      return rejectCodebaseMutate('mkdir', resolved);
    }

    // Honest no-op signal: `createDirectory` is recursive and never fails on an
    // existing directory, so without this check a repeated mkdir reads as fresh
    // progress ("Directory created") and can sustain a no-output loop.
    if (await fileSystem.fileExists(resolved.fsPath)) {
      console.log(`[mkdir] ℹ️ Directory already exists: ${resolved.displayPath}`);
      return { content: prependFixMessage(resolved, `Directory already exists (no-op): ${resolved.displayPath}`) };
    }

    await fileSystem.createDirectory(resolved.fsPath);
    console.log(`[mkdir] ✅ Created directory: ${resolved.displayPath}`);

    // `directoryCreated` is what makes the FE tree refresh: ToolOrchestrator is
    // the single owner of that notify and reads it off `sideEffects`. The
    // no-op return above deliberately emits nothing, so a repeated mkdir costs
    // no tree walk.
    return {
      content: prependFixMessage(resolved, `Directory created: ${resolved.displayPath}`),
      sideEffects: [{ type: 'directoryCreated', path: resolved.displayPath }],
    };
  } catch (e) {
    const errorMsg = (e as Error).message;
    console.error(`[mkdir] ❌ Error:`, errorMsg);
    return { content: `Error: ${errorMsg}`, error: errorMsg };
  }
}
