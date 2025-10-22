import { reviewerAgent } from "./agents/reviewer";
import { architectAgent } from "./agents/architect";
import { plannerAgent } from "./agents/planner";
import { docAgent } from "./agents/doc";
import { feedbackAgent } from "./agents/feedback";

export async function runPipeline({
  type,
  input,
  project,
  mode,
  inputFile
}: {
  type: "review" | "arch-design" | "arch-code" | "feedback" | "plan" | "doc";
  input: string;
  project?: string;
  mode?: 'design' | 'code';
  inputFile?: string;
}) {
  switch (type) {
    case "review":
      return await reviewerAgent(input, project || "default");
    case "arch-design":
      return await architectAgent(input, project || "default", 'design', inputFile);
    case "arch-code":
      return await architectAgent(input, project || "default", 'code', inputFile);
    case "feedback":
      if (!inputFile) throw new Error("Design file path required for feedback");
      return await feedbackAgent(inputFile, input, project || "default", false);
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
