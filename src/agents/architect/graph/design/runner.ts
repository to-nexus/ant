import { buildDesignGraph } from "./graph";
import { DesignGraphState } from "./state";

export async function runDesignGraph(initial: DesignGraphState) {
  const app = buildDesignGraph();
  const state = await (app as any).invoke(initial as any) as DesignGraphState;
  return { designFilePath: state.designFilePath!, markdown: state.designMarkdown };
}
