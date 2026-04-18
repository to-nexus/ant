/**
 * create_file handler — shadow tool (context-injected version)
 *
 * When LLM incorrectly calls 'file', 'write_file', or 'create_file' tool
 * instead of using <file> XML tag, this handler gracefully creates the file.
 */

import type { ToolExecutionContext, ToolResult, ToolSideEffect } from '../types';
import { resolveToolPath, prependFixMessage } from './pathResolver';
import { decideInvalidationScope } from './invalidationScope';

export async function handleCreateFile(
  ctx: ToolExecutionContext,
  args: { path: string; content: string },
): Promise<ToolResult> {
  const { path: filePath, content } = args;
  const fileSystem = ctx.fileSystem;

  if (!filePath) {
    const msg = 'create_file requires path';
    return { content: msg, error: msg };
  }

  if (content === undefined || content === null) {
    const msg = 'create_file requires content';
    return { content: msg, error: msg };
  }

  try {
    const resolved = await resolveToolPath(ctx, filePath);

    const workerFS = fileSystem as any;
    if (typeof workerFS.writeNewFile === 'function') {
      const result = await workerFS.writeNewFile(resolved.fsPath, content);
      if (!result.success) {
        console.log(`⚠️ [CreateFile] Conflict: ${result.error}`);
        const msg = result.error || `File "${resolved.displayPath}" was already created by another task. Use read_file + edit_file to merge your changes.`;
        await ctx.chatStatus.failFileCreation(filePath, msg);
        return { content: msg, error: msg };
      }
    } else {
      await fileSystem.writeFile(resolved.fsPath, content);
    }

    console.log(`✅ [CreateFile] Created ${resolved.displayPath} (${content.length} chars)`);
    console.log(`   ⚠️  Shadow tool used - LLM should use <file> XML tag instead`);

    await ctx.chatStatus.completeFileCreation(resolved.displayPath, content);

    if (ctx.fileTreeUpdate && ctx.project && ctx.featureFolder) {
      await ctx.fileTreeUpdate.notifyFileTreeUpdate(ctx.project, ctx.featureFolder);
    }

    const resultMsg = [
      `File created successfully: ${resolved.displayPath} (${content.length} chars)`,
      ``,
      `⚠️ IMPORTANT: Do NOT use tool calls for file creation.`,
      `Use the <file> XML tag instead, which enables real-time streaming:`,
      `<file path="${resolved.displayPath}">`,
      `...content...`,
      `</file>`,
    ].join('\n');

    // F2 — new files have no prior content to diff against; decideInvalidationScope
    // treats an undefined oldContent as "conservative fallback" for manifests.
    const decision = decideInvalidationScope(resolved.displayPath, {
      oldContent: undefined,
      newContent: content,
    });
    const sideEffects: ToolSideEffect[] = [
      { type: 'fileCreated', path: resolved.displayPath },
      {
        type: 'verificationInvalidated',
        scope: decision.scope,
        reason: decision.reason,
        ...(decision.installNeeded ? { installNeeded: true } : {}),
      },
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
