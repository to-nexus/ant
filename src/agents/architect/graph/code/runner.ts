import * as fs from "fs";
import * as path from "path";
import { ArchitectGraphState } from "./state";
import { buildCodeGraph } from "./graph";

export async function runCodeGraph(initial: ArchitectGraphState) {
  const app = buildCodeGraph();
  const result = await (app as any).invoke(initial as any);
  const state = result as ArchitectGraphState;

  const gitPort = state.gitPort || initial.gitPort;
  if (!gitPort) {
    throw new Error("GitPort not provided for code generation");
  }

  const branch = state.context.featureFolder
    ? `feature/${state.context.featureFolder}`
    : `feature/${state.context.project}-arch-${Date.now()}`;
  await gitPort.createBranch(branch, state.context.config.branchBase);

  const repoRoot = await gitPort.getRepoRoot();
  for (const f of state.files) {
    const fullPath = path.join(repoRoot, f.path);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, f.content, "utf8");
    console.log(`✏️  Modified: ${f.path}`);
  }

  // Generate simple report
  const reportFile = `Generated ${state.files.length} files`;
  return { branch, reportFile, filesChanged: state.files.length };
}
