/**
 * append_file handler — tail-concat to an EXISTING file.
 *
 * The tool-call counterpart of the retired `<append>` streaming tag. Two
 * sanctioned uses (mirrored in the schema description):
 *   1. Chunked authoring — continuing a large file started with create_file.
 *   2. Truncation resume — continuing a file whose creation was cut off by
 *      the output-token limit (the salvage prefix is already on disk).
 *
 * Parallel-safe: read + concatenated write go through the worker filesystem
 * (SharedFileBuffer OCC) when present, so a cross-worker mutation between
 * read and write surfaces as a conflict instead of a silent clobber.
 */

import type { ToolExecutionContext, ToolResult, ToolSideEffect } from '../types';
import { resolveToolPath, prependFixMessage } from './pathResolver';
import { rejectCodebaseMutate, shouldRejectCodebaseMutate } from './codebaseGate';

export async function handleAppendFile(
  ctx: ToolExecutionContext,
  args: { path: string; content: string },
): Promise<ToolResult> {
  const { path: filePath, content } = args;
  const fileSystem = ctx.fileSystem;

  if (!filePath) {
    const msg = 'append_file requires path';
    return { content: msg, error: msg };
  }

  if (content === undefined || content === null || content === '') {
    const msg = 'append_file requires non-empty content';
    return { content: msg, error: msg };
  }

  try {
    const resolved = await resolveToolPath(ctx, filePath);

    if (shouldRejectCodebaseMutate(ctx, resolved)) {
      const rejection = rejectCodebaseMutate('append_file', resolved);
      await ctx.chatStatus.failFileCreation(filePath, rejection.error);
      return rejection;
    }

    const existing = await fileSystem.readFile(resolved.fsPath);
    if (existing === null || existing === undefined) {
      const msg =
        `append_file target "${resolved.displayPath}" does not exist. ` +
        `Use create_file to author a new file; append_file only extends existing ones.`;
      await ctx.chatStatus.failFileCreation(filePath, msg);
      return { content: msg, error: msg };
    }

    // Read-then-write through the worker FS keeps SharedFileBuffer OCC
    // semantics (readFile tracked the version; writeFile checks it).
    await fileSystem.writeFile(resolved.fsPath, existing + content);

    console.log(`✅ [AppendFile] Appended ${content.length} chars to ${resolved.displayPath}`);

    // Card body shows the appended chunk (parity with the old <append> card).
    await ctx.chatStatus.completeFileCreation(resolved.displayPath, content);
    ctx.recordFileTouch?.('update', resolved.displayPath);

    if (ctx.fileTreeUpdate && ctx.project && ctx.featureFolder) {
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

    const resultMsg = `Appended ${content.length} chars to ${resolved.displayPath} (now ${existing.length + content.length} chars)`;

    const sideEffects: ToolSideEffect[] = [
      { type: 'fileModified', path: resolved.displayPath },
    ];

    return {
      content: prependFixMessage(resolved, resultMsg),
      sideEffects,
    };
  } catch (e) {
    const errorMsg = (e as Error).message;
    await ctx.chatStatus.failFileCreation(filePath, errorMsg);
    return { content: `Error: ${errorMsg}`, error: errorMsg };
  }
}
