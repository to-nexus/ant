import { getDirectivePath, readDirective, findLatestDesign } from "../../../utils";
import { ArchitectGraphState } from "../state";

/**
 * Resolve inputs for code generation:
 * - Latest design document
 * - Code directive (if exists)
 * - Original files from HEAD (git)
 */
export async function resolve(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  const { context } = state;

  const latestDesign = findLatestDesign(context);
  if (!latestDesign) {
    throw new Error("No design document found. Run arch-design first.");
  }

  const directivePath = getDirectivePath(context, 'code');
  const directive = readDirective(directivePath, 'code') || "";

  // Get original files from HEAD if working tree has changes
  const git = state.deps?.git ? state.deps.git : null as any;
  const changes = await git.diff();
  let originalFilesBlock = "";
  
  if (changes.length > 0) {
    const changedFiles = await (await git.status()).files.map((f: any) => f.path);
    const originals: Array<{ path: string; content: string }> = [];
    
    for (const p of changedFiles) {
      const content = await git.show([`HEAD:${p}`]).catch(() => null);
      if (content !== null) {
        originals.push({ path: p, content });
      }
    }
    
    if (originals.length) {
      originalFilesBlock = originals.map(f => `FILE: ${f.path}\n${f.content}`).join("\n\n---\n\n");
    }
  }

  return {
    ...state,
    latestDesign,
    directive,
    originalFilesBlock,
  };
}

