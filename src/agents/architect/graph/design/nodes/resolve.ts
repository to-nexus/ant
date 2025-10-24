import { HumanMessage } from "@langchain/core/messages";
import { getDirectivePath, readDirective, findLatestDesign } from "../../../utils";
import { DesignGraphState } from "../state";

export async function resolve(state: DesignGraphState) {
  const previousDesign = findLatestDesign(state.context);
  const directivePath = getDirectivePath(state.context, 'design');
  const directive = readDirective(directivePath, 'design') || '';
  return { previousDesign, directive };
}
