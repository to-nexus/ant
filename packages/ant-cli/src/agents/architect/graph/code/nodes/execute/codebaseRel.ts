/**
 * codebaseRel — derive the codebase directory relative path.
 *
 * Shared SSOT for execute/index.ts (guardrail + path manifest) and
 * execute/buildMessages.ts (Modify Targets content loading). Both must
 * resolve the same `codebaseRel` the FileRenderer uses at write time so
 * on-disk reads (`buildModifyTargetsSection`) and on-disk writes stay in
 * lockstep.
 *
 * Falls back to `'codebase'` when git/fileSystem are unavailable. That
 * matches the legacy default used throughout the code job.
 */

import * as path from 'path';
import type { ArchitectGraphState } from '../../state';

export async function resolveCodebaseRel(state: ArchitectGraphState): Promise<string> {
  const fileSystem = state.deps?.fileSystem;
  const gitPort = state.deps?.git;
  if (!fileSystem || !gitPort) return 'codebase';

  const wsRoot = fileSystem.getRootPath?.();
  if (!wsRoot) return 'codebase';

  let repoRoot: string | undefined;
  try {
    repoRoot = await gitPort.getRepoRoot();
  } catch {
    repoRoot = undefined;
  }
  if (!repoRoot) return 'codebase';

  return path.relative(wsRoot, repoRoot).replace(/\\/g, '/') || 'codebase';
}
