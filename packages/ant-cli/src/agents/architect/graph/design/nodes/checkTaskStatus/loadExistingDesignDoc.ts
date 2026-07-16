/**
 * Refactor-mode existing-document loader — single owner of the disk-read +
 * path-normalization quirks shared by decompose baseline capture and the
 * plan / execute prompt builders. Returns undefined when the doc is missing
 * or unreadable (callers decide how loudly to react).
 *
 * Lives beside `specDocIntegrity.ts` because the two form the revision
 * contract's data plane: this loads the pre-revision document, that one
 * validates the post-revision one.
 */
import path from 'node:path';
import { designDirOf } from '@ant/shared';

interface StateLike {
  // Index signature keeps this assignable from ProjectContext-shaped
  // contexts, which declare featurePath only via `[key: string]: any`.
  context?: { featurePath?: string; [key: string]: any };
  deps?: {
    fileSystem?: {
      fileExists(p: string): Promise<boolean>;
      readFile(p: string): Promise<string | null>;
      getRootPath?(): string;
    };
  };
}

export async function loadExistingDesignDoc(
  state: StateLike,
  targetFile: string,
  targetDir?: string,
): Promise<string | undefined> {
  try {
    const fs = state.deps?.fileSystem;
    if (!fs || !state.context?.featurePath) return undefined;
    const dir = targetDir ?? designDirOf(targetFile);
    let docPath = `${state.context.featurePath}/${dir}/${targetFile}`;
    const rootPath = fs.getRootPath?.();
    if (rootPath && path.isAbsolute(docPath)) {
      docPath = path.relative(rootPath, docPath);
    }
    if (!(await fs.fileExists(docPath))) return undefined;
    const content = await fs.readFile(docPath);
    return content || undefined;
  } catch {
    return undefined;
  }
}
