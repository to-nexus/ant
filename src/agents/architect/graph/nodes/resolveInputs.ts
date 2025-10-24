import { getDirectivePath, readDirective, findLatestDesign } from "../../utils";
import { getGitInstance, getChangedFiles, getFileFromHead, loadProjectGitConfig } from "../../../../tools/git";
import { ArchitectGraphState } from "../state";

export async function resolveInputs(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  const { context } = state;
  // Ensure config present
  context.config = context.config || await loadProjectGitConfig(context.project);

  const latestDesign = findLatestDesign(context);
  if (!latestDesign) {
    throw new Error("No design document found. Run arch-design first.");
  }

  const directivePath = getDirectivePath(context, 'code');
  const directive = readDirective(directivePath, 'code') || "";

  const git = await getGitInstance(context.project, context.config);
  const changes = await git.diff();
  let originalFilesBlock = "";
  if (changes.length > 0) {
    const changedFiles = await getChangedFiles(git);
    const originals: Array<{ path: string; content: string }> = [];
    for (const p of changedFiles) {
      const content = await getFileFromHead(git, p);
      if (content !== null) originals.push({ path: p, content });
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
