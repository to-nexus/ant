/**
 * create_file handler — shadow tool (context-injected version)
 *
 * When LLM incorrectly calls 'file', 'write_file', or 'create_file' tool
 * instead of using <file> XML tag, this handler gracefully creates the file.
 */

import type { ToolExecutionContext, ToolResult, ToolSideEffect } from '../types';
import { resolveToolPath, prependFixMessage } from './pathResolver';
import {
  decideInvalidationScope,
  isDepManifestPath,
  DEP_MANIFEST_INSTALL_HINT,
} from './invalidationScope';
import { enforceManifestPinPolicyForWrite } from './manifestPinPolicy';
import { packageManagerMutex } from './runCommand';

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

    // Manifest creates share `packageManagerMutex` with the run_command
    // install guards so the snapshot scan + policy check + actual write
    // are atomic vs. concurrent installs and concurrent manifest writes
    // from sibling workers. Non-manifest creates take the fast path
    // (no mutex, no scan).
    const isManifestCreate = isDepManifestPath(resolved.displayPath);

    const performCreate = async (): Promise<ToolResult | null> => {
      if (isManifestCreate) {
        const rejection = await enforceManifestPinPolicyForWrite(
          resolved.displayPath,
          content,
          fileSystem.getRootPath(),
          resolved.displayPath,
        );
        if (rejection) {
          const policyMsg = `[Policy] ${rejection.display}`;
          await ctx.chatStatus.failFileCreation(filePath, policyMsg);
          return { content: policyMsg, error: policyMsg };
        }
      }

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
      return null;
    };

    const earlyReturn = isManifestCreate
      ? await packageManagerMutex.runExclusive(performCreate)
      : await performCreate();
    if (earlyReturn) return earlyReturn;

    console.log(`✅ [CreateFile] Created ${resolved.displayPath} (${content.length} chars)`);
    console.log(`   ⚠️  Shadow tool used - LLM should use <file> XML tag instead`);

    await ctx.chatStatus.completeFileCreation(resolved.displayPath, content);
    ctx.recordFileTouch?.('create', resolved.displayPath);

    if (ctx.fileTreeUpdate && ctx.project && ctx.featureFolder) {
      await ctx.fileTreeUpdate.notifyFileTreeUpdate(ctx.project, ctx.featureFolder);
      // Feature-workspace contract: files written under generated-artifact
      // domains (`architecture/`, `visual/`, `meta/evals/`) are surfaced
      // with an unseen badge. The gate is path-prefix only (no job-type
      // branch) so the rule applies wherever a tool-call write lands inside
      // a workspace — matching `chat.routes.ts` / `transfer.routes.ts` /
      // FileRenderer.
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
      },
    ];

    const manifestSuffix = isDepManifestPath(resolved.displayPath) ? DEP_MANIFEST_INSTALL_HINT : '';
    return {
      content: prependFixMessage(resolved, resultMsg + manifestSuffix),
      sideEffects,
    };
  } catch (e) {
    const errorMsg = (e as Error).message;
    await ctx.chatStatus.failFileCreation(filePath, errorMsg);
    return { content: `Error: ${errorMsg}`, error: errorMsg };
  }
}
