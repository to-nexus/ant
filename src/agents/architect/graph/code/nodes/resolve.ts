import { getDirective, findLatestDesign } from "../../../utils";
import { ArchitectGraphState } from "../state";

/**
 * Resolve inputs for code generation:
 * - Latest design document (optional - not required for small changes)
 * - Code directive (if exists)
 * - Original files from HEAD (git)
 * - Codebase profile (language/framework detection)
 * 
 * Strategy:
 * - Large/new features: Require design doc (from design task)
 * - Small changes/fixes: Directive only (design doc optional)
 */
export async function resolve(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  const { context } = state;

  // Try to find design document (optional)
  const latestDesign = findLatestDesign(context) || "";

  // Load directive (optional)
  const directive = getDirective(context, 'code') || "";
  
  // Validate: Must have either design doc OR directive
  if (!latestDesign && !directive) {
    throw new Error(
      "No design document or directive found.\n" +
      "For new features: Run arch-design first.\n" +
      "For modifications: Provide a directive in workspace/{project}/{feature}/inputs/directives/code/directive.md"
    );
  }

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

  // Analyze codebase to detect language and framework
  let codebaseProfile = null;
  const analyzer = state.deps?.analyzer;
  
  if (originalFilesBlock && analyzer) {
    try {
      codebaseProfile = await analyzer.analyze(originalFilesBlock, context.workingDir);
      console.log(`📊 Detected codebase: ${codebaseProfile.language}${codebaseProfile.framework ? ` + ${codebaseProfile.framework}` : ''}`);
    } catch (error) {
      console.warn('Failed to analyze codebase:', error);
      // Continue without profile (graceful degradation)
    }
  }

  return {
    ...state,
    latestDesign,
    directive,
    originalFilesBlock,
    codebaseProfile,
  };
}

