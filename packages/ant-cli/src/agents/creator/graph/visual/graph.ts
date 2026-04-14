/**
 * Visual Job Graph
 *
 * LangGraph StateGraph for the visual job.
 *
 * Flow:
 *   __start__ → resolve → triage → (conditional)
 *     triage:proceed → detect → direct → (conditional)
 *       direct:sketch  → sketch  → (conditional: deliver | direct)
 *       direct:render  → render  → (conditional: deliver | direct)
 *       direct:engrave → engrave → (conditional: deliver | __end__)
 *       direct:deliver → deliver (finalize: sketch used as-is, no render)
 *       direct:clarify → __end__
 *       direct:end     → __end__
 *     triage:ask/redirect/blocked → __end__
 *
 *   sketch → deliver → __end__ (sketches saved, await user selection)
 *   render → deliver → __end__ (final image saved via img2img)
 *   engrave → deliver → __end__ (SVG saved)
 *
 * Safety blocked in sketch/render → loops back to direct for prompt revision.
 */

import { StateGraph, END } from '@langchain/langgraph';
import { VisualGraphAnnotation, VisualGraphState } from './types.js';
import { visualResolveStrategy } from './nodes/resolve.js';
import { createResolveNode } from '../../../common/graph/nodes/resolve/index.js';
import { createDetectNode } from '../../../common/graph/nodes/detect/index.js';
import { visualDetectStrategy } from './nodes/detectStrategy.js';
import { directNode, routeAfterDirect } from './nodes/direct.js';
import { sketchNode, routeAfterSketch } from './nodes/sketch.js';
import { renderNode, routeAfterRender } from './nodes/render.js';
import { engraveNode, routeAfterEngrave } from './nodes/engrave.js';
import { deliverNode } from './nodes/deliver.js';
import { explainNode } from './nodes/explain.js';
import { triage } from '../../../common/graph/nodes/triage/index.js';

/**
 * Router after triage for visual job.
 * Proceeds to 'detect' on work:proceed, ends on ask/redirect/blocked.
 */
function routeAfterVisualTriage(state: VisualGraphState): string {
  const result = state.triageResult;

  if (!result) {
    console.log('[VisualTriageRouter] No triage result → detect');
    return 'detect';
  }

  if (result.intent === 'ask') {
    console.log('[VisualTriageRouter] ask → __end__');
    return '__end__';
  }

  if (result.workStatus === 'redirect') {
    console.log('[VisualTriageRouter] redirect → __end__');
    return '__end__';
  }

  if (result.workStatus === 'blocked') {
    console.log('[VisualTriageRouter] blocked → __end__');
    return '__end__';
  }

  console.log('[VisualTriageRouter] proceed → detect');
  return 'detect';
}

function routeAfterDetect(state: VisualGraphState): string {
  if (state.sketchIntent) {
    console.log(`[DetectRouter] sketchIntent=${state.sketchIntent} → direct`);
    return 'direct';
  }
  if (state.jobMode === 'explain') {
    console.log('[DetectRouter] explain mode → explain');
    return 'explain';
  }
  console.log('[DetectRouter] generate mode → direct');
  return 'direct';
}

export function buildVisualGraph() {
  const graph = new StateGraph(VisualGraphAnnotation);

  // Add nodes
  graph.addNode('resolve', createResolveNode(visualResolveStrategy) as any);
  graph.addNode('triage', triage as any);
  graph.addNode('detect', createDetectNode(visualDetectStrategy) as any);
  graph.addNode('direct', directNode as any);
  graph.addNode('sketch', sketchNode as any);
  graph.addNode('render', renderNode as any);
  graph.addNode('engrave', engraveNode as any);
  graph.addNode('deliver', deliverNode as any);
  graph.addNode('explain', explainNode as any);

  // Fixed edges
  graph.addEdge('__start__' as any, 'resolve' as any);
  graph.addEdge('resolve' as any, 'triage' as any);

  // Triage → detect (handles its own skip via skipClassify) | __end__
  graph.addConditionalEdges(
    'triage' as any,
    routeAfterVisualTriage as any,
    {
      detect: 'detect',
      __end__: END,
    } as any
  );

  // Detect → direct | explain (conditional based on jobMode + sketchIntent)
  graph.addConditionalEdges(
    'detect' as any,
    routeAfterDetect as any,
    { explain: 'explain', direct: 'direct' } as any
  );

  graph.addEdge('explain' as any, '__end__' as any);

  // Direct → sketch | render | engrave | deliver | __end__
  graph.addConditionalEdges(
    'direct' as any,
    routeAfterDirect as any,
    {
      sketch: 'sketch',
      render: 'render',
      engrave: 'engrave',
      deliver: 'deliver',
      __end__: END,
    } as any
  );

  // Sketch → deliver | direct (safety retry) | __end__
  graph.addConditionalEdges(
    'sketch' as any,
    routeAfterSketch as any,
    {
      deliver: 'deliver',
      direct: 'direct',
      __end__: END,
    } as any
  );

  // Render → deliver | direct (safety retry) | __end__
  graph.addConditionalEdges(
    'render' as any,
    routeAfterRender as any,
    {
      deliver: 'deliver',
      direct: 'direct',
      __end__: END,
    } as any
  );

  // Engrave → deliver | __end__
  graph.addConditionalEdges(
    'engrave' as any,
    routeAfterEngrave as any,
    {
      deliver: 'deliver',
      __end__: END,
    } as any
  );

  // Deliver always ends
  graph.addEdge('deliver' as any, '__end__' as any);

  return graph.compile();
}

