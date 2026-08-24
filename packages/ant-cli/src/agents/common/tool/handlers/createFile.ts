/**
 * create_file handler — context-injected version
 *
 * Creates a NEW file (fails if it already exists — parallel-safe via
 * WorkerFileSystem.writeNewFile conflict detection). This is THE authoring
 * channel for new files (tool-call protocol; ToolFileStreamer renders the
 * argument stream live).
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
import { isBinaryPath } from '../../../../core/utils/binaryExtensions';

export async function handleCreateFile(
  ctx: ToolExecutionContext,
  args: { path: string; content: string; overwrite?: boolean },
): Promise<ToolResult> {
  const { path: filePath, content, overwrite } = args;
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

    if (shouldRejectCodebaseMutate(ctx, resolved)) {
      const rejection = rejectCodebaseMutate('create_file', resolved);
      await ctx.chatStatus.failFileCreation(filePath, rejection.error);
      return rejection;
    }

    // Binary gate — the target does not exist yet, so the verdict comes from the
    // extension set (which deliberately excludes text formats behind
    // asset-looking names: `.svg`, `.gltf`, `.obj`).
    //
    // `FileSystemAdapter.writeFile` already refuses these, but in parallel-worker
    // mode the write goes through `SharedFileBuffer` and is not flushed until
    // later — so `create_file("codebase/public/shot.png", "<text>")` reported
    // SUCCESS to the LLM and the rejection surfaced detached from its cause.
    // `edit_file` refuses at the call; three prompt surfaces and the `copy_file`
    // schema all state that `create_file` does too. Now it does.
    if (isBinaryPath(resolved.fsPath)) {
      const msg =
        `Cannot create binary file: ${resolved.displayPath}. ` +
        `Binary bytes cannot be authored as text — a utf-8 write produces a corrupt file. ` +
        `Place an existing asset with copy_file(source, destination) instead.`;
      await ctx.chatStatus.failFileCreation(filePath, msg);
      return { content: msg, error: msg };
    }

    // Manifest creates share `packageManagerMutex` with the run_command
    // install guards so the snapshot scan + policy check + actual write
    // are atomic vs. concurrent installs and concurrent manifest writes
    // from sibling workers. Non-manifest creates take the fast path
    // (no mutex, no scan).
    const isManifestCreate = isDepManifestPath(resolved.displayPath);
    // Replaced line count on a deliberate overwrite — feeds the `+N / -X`
    // chip pair on the chat card (set inside performCreate).
    let diffBeforeLines: number | undefined;

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
      if (overwrite === true) {
        // Deliberate full replacement (explicit `overwrite: true`).
        // Capture the replaced line count BEFORE the write for the chat
        // card's `+N / -X` chip pair.
        const prior = await fileSystem.readFile(resolved.fsPath).catch(() => null);
        diffBeforeLines = typeof prior === 'string' && prior.length > 0
          ? prior.split('\n').length
          : undefined;
        if (typeof workerFS.writeOverwrite === 'function') {
          const result = await workerFS.writeOverwrite(resolved.fsPath, content);
          if (!result.success) {
            console.log(`⚠️ [CreateFile] Overwrite conflict: ${result.error}`);
            const msg = result.error || `File "${resolved.displayPath}" was modified by another task. Read it and merge via edit_file.`;
            await ctx.chatStatus.failFileCreation(filePath, msg);
            return { content: msg, error: msg };
          }
        } else {
          await fileSystem.writeFile(resolved.fsPath, content);
        }
      } else if (typeof workerFS.writeNewFile === 'function') {
        const result = await workerFS.writeNewFile(resolved.fsPath, content);
        if (!result.success) {
          console.log(`⚠️ [CreateFile] Conflict: ${result.error}`);
          const msg = result.error || `File "${resolved.displayPath}" was already created by another task. Use read_file + edit_file to merge your changes.`;
          await ctx.chatStatus.failFileCreation(filePath, msg);
          return { content: msg, error: msg };
        }
      } else {
        const exists = await fileSystem.fileExists?.(resolved.fsPath);
        if (exists) {
          const msg = `File "${resolved.displayPath}" already exists. Use edit_file to modify it, or create_file with overwrite: true for a deliberate full replacement.`;
          await ctx.chatStatus.failFileCreation(filePath, msg);
          return { content: msg, error: msg };
        }
        await fileSystem.writeFile(resolved.fsPath, content);
      }
      return null;
    };

    const earlyReturn = isManifestCreate
      ? await packageManagerMutex.runExclusive(performCreate)
      : await performCreate();
    if (earlyReturn) return earlyReturn;

    console.log(`✅ [CreateFile] ${overwrite ? 'Overwrote' : 'Created'} ${resolved.displayPath} (${content.length} chars)`);

    await ctx.chatStatus.completeFileCreation(
      resolved.displayPath,
      content,
      diffBeforeLines !== undefined ? { diffBeforeLines } : undefined,
    );
    ctx.recordFileTouch?.('create', resolved.displayPath);

    if (ctx.fileTreeUpdate && ctx.project && ctx.featureFolder) {
      // Feature-workspace contract: files written under generated-artifact
      // domains (`architecture/`, `visual/`, `meta/evals/`) are surfaced
      // with an unseen badge. The gate is path-prefix only (no job-type
      // branch) so the rule applies wherever a tool-call write lands inside
      // a workspace — matching `chat.routes.ts` / `transfer.routes.ts`.
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

    const resultMsg = overwrite
      ? `File overwritten successfully: ${resolved.displayPath} (${content.length} chars)`
      : `File created successfully: ${resolved.displayPath} (${content.length} chars)`;

    const sideEffects: ToolSideEffect[] = [
      overwrite
        ? { type: 'fileModified', path: resolved.displayPath }
        : { type: 'fileCreated', path: resolved.displayPath },
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
