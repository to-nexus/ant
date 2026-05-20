import type { JobType } from '@ant/shared';
import { ARCHITECT_TOOLS } from '../../agents/common/tool/toolSchemas';
import {
  PLANNER_TOOLS,
  PLANNER_EXPLAIN_TOOLS,
} from '../../agents/planner/graph/plan/nodes/tools';
import { VISUAL_SKETCH_TOOLS } from '../../agents/creator/graph/visual/nodes/sketchTools';
import { ASK_TOOLS, WORKSPACE_TOOLS } from '../../agents/architect/graph/ask/tools';

export interface LooseToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

function normalize(t: { name: string; description: string; input_schema?: unknown; parameters?: unknown }): LooseToolDef {
  return {
    name: t.name,
    description: t.description,
    input_schema: (t.input_schema ?? t.parameters ?? { type: 'object', properties: {} }) as Record<string, unknown>,
  };
}

const ARCH_LIST: LooseToolDef[] = Object.values(ARCHITECT_TOOLS).map(normalize);

const CODE_TOOLS: LooseToolDef[] = ARCH_LIST.filter(t =>
  ['read_file', 'edit_file', 'list_files', 'search_code', 'delete_file', 'mkdir',
   'run_command', 'search_reference_code', 'search_web',
   'figma_get_metadata', 'figma_get_design_context', 'figma_get_screenshot',
   'figma_get_variable_defs'].includes(t.name),
);

const DESIGN_TOOLS: LooseToolDef[] = ARCH_LIST.filter(t =>
  ['read_file', 'edit_file', 'list_files', 'search_code', 'delete_file', 'mkdir',
   'search_web', 'list_assets', 'download_asset',
   'figma_get_metadata', 'figma_get_design_context', 'figma_get_screenshot',
   'figma_get_variable_defs'].includes(t.name),
);

const ASK_COMBINED: LooseToolDef[] = [...ASK_TOOLS, ...WORKSPACE_TOOLS].map(normalize);
const PLANNER_TOOLS_N: LooseToolDef[] = PLANNER_TOOLS.map(normalize);
const PLANNER_EXPLAIN_TOOLS_N: LooseToolDef[] = PLANNER_EXPLAIN_TOOLS.map(normalize);
const VISUAL_SKETCH_TOOLS_N: LooseToolDef[] = VISUAL_SKETCH_TOOLS.map(normalize);

export function getToolDefsFor(job: JobType, node: string): LooseToolDef[] {
  switch (job) {
    case 'code':
    case 'learn':
      return CODE_TOOLS;
    case 'design':
      return DESIGN_TOOLS;
    case 'plan':
      return node === 'detect' ? PLANNER_EXPLAIN_TOOLS_N : PLANNER_TOOLS_N;
    case 'visual':
      return node === 'sketch' ? VISUAL_SKETCH_TOOLS_N : [];
    case 'ask':
    case 'inline-ask':
      return ASK_COMBINED;
    default:
      return [];
  }
}
