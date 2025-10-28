import { getDirective, getSource, findLatestDesign } from "../../../utils";
import { DesignGraphState } from "../state";

export async function resolve(state: DesignGraphState) {
  const { context } = state;

  // Load source materials (PRD + resources)
  const source = getSource(context);
  const spec = source.prd;

  // Load directive (optional)
  const directive = getDirective(context, 'design') || "";

  // Load previous design (optional)
  const previousDesign = findLatestDesign(context) || "";

  return {
    ...state,
    spec,
    directive,
    previousDesign
  };
}
