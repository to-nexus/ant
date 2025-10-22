import { reviewerAgent } from "./agents/reviewer";
import { architectAgent } from "./agents/architect/index";
import { plannerAgent } from "./agents/planner";
import { docAgent } from "./agents/doc";

export async function runPipeline({
  type,
  input,
  project,
  inputFile
}: {
  type: "review" | "arch-design" | "arch-code" | "arch-learn" | "plan" | "doc";
  input: string;
  project?: string;
  inputFile?: string;
}) {
  switch (type) {
    case "review":
      return await reviewerAgent(input, project || "default");
    case "arch-design":
      return await architectAgent(input, project || "default", 'design', inputFile);
    case "arch-code":
      return await architectAgent(input, project || "default", 'code', inputFile);
    case "arch-learn":
      return await architectAgent(input, project || "default", 'learn', inputFile);
    case "plan": {
      const [issues, commits] = input.split("===COMMITS===");
      return await plannerAgent(issues, commits);
    }
    case "doc":
      return await docAgent(input);
    default:
      throw new Error("Unknown agent type");
  }
}
