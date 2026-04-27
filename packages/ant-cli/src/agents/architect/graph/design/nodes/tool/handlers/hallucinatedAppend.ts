/**
 * Hallucinated `append_file` handler — ctx-pure.
 *
 * The design LLM occasionally calls `append_file` instead of using the
 * `<append>` XML tag. Returning an error wastes a retry; instead the
 * handler intercepts the call and appends-or-creates the file directly.
 * `write_file` is covered by `common/tool/handlers/createFile.ts` (shadow
 * alias to CREATE_FILE), so this module handles only the append case.
 */

import type { ToolExecutionContext, ToolResult } from '../../../../../../common/tool/types';
import { resolveToolPath, prependFixMessage } from '../../../../../../common/tool/handlers/pathResolver';

export async function handleAppendFile(
  ctx: ToolExecutionContext,
  args: { path: string; content: string },
): Promise<ToolResult> {
  const { path: filePath, content } = args;

  if (!filePath) {
    const msg = 'append_file requires path';
    return { content: msg, error: msg };
  }
  if (content === undefined || content === null) {
    const msg = 'append_file requires content';
    return { content: msg, error: msg };
  }

  const fileSystem = ctx.fileSystem;
  if (!fileSystem) {
    const msg = 'FileSystemPort not available';
    return { content: msg, error: msg };
  }

  const resolved = await resolveToolPath(ctx, filePath);

  ctx.chatStatus.startFileEdit(resolved.displayPath);

  try {
    const exists = await fileSystem.fileExists(resolved.fsPath);
    if (exists) {
      const existing = await fileSystem.readFile(resolved.fsPath);
      await fileSystem.writeFile(resolved.fsPath, (existing || '') + '\n' + content);
    } else {
      await fileSystem.writeFile(resolved.fsPath, content);
    }

    ctx.recordFileTouch?.(exists ? 'update' : 'create', resolved.displayPath);

    if (ctx.fileTreeUpdate && ctx.project && ctx.featureFolder) {
      ctx.fileTreeUpdate.notifyFileTreeUpdate(ctx.project, ctx.featureFolder);
      if ('addUnseenArtifacts' in ctx.fileTreeUpdate && resolved.displayPath.startsWith('outputs/')) {
        (ctx.fileTreeUpdate as any).addUnseenArtifacts(
          ctx.project, ctx.featureFolder, [resolved.displayPath]
        );
      }
    }

    await ctx.chatStatus.completeFileEdit(resolved.displayPath, '', content);

    const msg = `File appended successfully: ${resolved.displayPath} (auto-recovered from append_file tool call). ` +
      `Use the <append> XML tag instead so streaming works.`;
    return { content: prependFixMessage(resolved, msg) };
  } catch (e) {
    const errMsg = (e as Error).message;
    await ctx.chatStatus.failFileEdit(resolved.displayPath, errMsg);
    return { content: `Error: ${errMsg}`, error: errMsg };
  }
}
