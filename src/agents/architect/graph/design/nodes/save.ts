import * as fs from "fs";
import * as path from "path";
import { DesignGraphState } from "../state";

export function save(state: DesignGraphState) {
  const designDir = path.join(
    state.context.workingDir,
    "projects",
    state.context.project,
    state.context.featureFolder || "default",
    "generated",
    "design"
  );
  fs.mkdirSync(designDir, { recursive: true });
  const designFilePath = path.join(designDir, `design-${state.context.project}-${Date.now()}.md`);
  fs.writeFileSync(designFilePath, state.designMarkdown, "utf8");
  return { designFilePath };
}
