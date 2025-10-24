import * as fs from "fs";
import * as path from "path";
import { ArchitectGraphState } from "../state";
import { buildCodeGraph } from "./graph";
import { createBranch, getGitInstance } from "../../../../tools/git";
import { report } from "../nodes/report";

export async function runCodeGraph(initial: ArchitectGraphState) {
  const app = buildCodeGraph();
  const result = await (app as any).invoke(initial as any);
  const state = result as ArchitectGraphState;

  const git = await getGitInstance(state.context.project, state.context.config);
  const branch = state.context.featureFolder
    ? `feature/${state.context.featureFolder}`
    : `feature/${state.context.project}-arch-${Date.now()}`;
  await createBranch(git, branch, state.context.config.branchBase);

  const baseDir = await git.revparse(['--show-toplevel']);
  for (const f of state.files) {
    const fullPath = path.join(baseDir.trim(), f.path);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, f.content, "utf8");
    console.log(`✏️  Modified: ${f.path}`);
  }

  const { reportFile } = report(state);
  return { branch, reportFile, filesChanged: state.files.length };
}
