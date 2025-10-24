import { buildLearnGraph } from "./graph";
import { LearnGraphState } from "./state";

export async function runLearnGraph(initial: LearnGraphState) {
  const app = buildLearnGraph();
  const state = await (app as any).invoke(initial as any) as LearnGraphState;
  return { stored: state.texts.length };
}
