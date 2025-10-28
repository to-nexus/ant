import { LearnGraphState } from "../state";
import { storeLearnings } from "../../../memory/storage";

export async function store(state: LearnGraphState): Promise<Partial<LearnGraphState>> {
  const joined = state.texts.join("\n\n---\n\n");
  await storeLearnings(joined, state.context.project, state.context.featureFolder || "default");
  return state;
}
