/**
 * Visual Graph State Types
 *
 * Annotation.Root = SSOT. VisualGraphState interface kept for node signatures
 * (too many fields for typeof Annotation.State to be ergonomic).
 */

import { Annotation } from '@langchain/langgraph';
import { DetectableFields } from '../../../common/graph/annotationHelpers.js';
import { TriageableState, TriageableContext } from '../../../common/graph/nodes/triage/types.js';
import type { DetectableState } from '../../../common/graph/nodes/detect/types.js';
import { LLMClient } from '../../../../core/ports/llm.js';
import { ImageGenerationPort, GeneratedImage } from '../../../../core/ports/imageGeneration.js';
import { BackgroundRemovalPort } from '../../../../core/ports/backgroundRemoval.js';
import { TaskQueueUpdatePort, FileTreeUpdatePort } from '../../../../core/ports/index.js';
import { WorkflowStateUpdatePort } from '../../../../core/ports/workflow.js';
import { TokenUsage, PhaseTrackingState } from '../../../common/graph/llmHelpers.js';
import { VisualSettings } from '../../../../core/types/workspace.js';
import type { ConversationEntry } from '../../../../core/types/session.js';
import type { Conversations } from '../../../common/graph/conversations.js';
import type { ConversationCompaction } from '../../../../core/context/compactJob.js';
import type { Mode } from '@ant/shared';


/** Visual-pipeline-local asset type */
export type VisualAssetType = 'logo' | 'icon' | 'hero' | 'illustration' | 'general';

/**
 * Sketch image with full parameter preservation for render step
 */
export interface SketchImage {
  data: Buffer;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  prompt: string;
  modelConfig: {
    model: string;
    aspectRatio?: string;
  };
  modelResponseMetadata?: Record<string, any>;
  index: number;
}

/**
 * SVG sketch for engrave node
 */
export interface SvgSketch {
  code: string;
  prompt: string;
  index: number;
}

/**
 * Per-sketch variation: direction-specific prompt suffix + UI label
 */
export interface SketchVariation {
  prompt: string;
  label: string;
}

export const VISUAL_ASSET_TYPES: readonly VisualAssetType[] = ['logo', 'icon', 'hero', 'illustration', 'general'] as const;

/**
 * Output specification derived from asset type.
 * Determines target format and required post-processing for the deliver node.
 */
export interface VisualOutputSpec {
  format: 'png' | 'jpeg' | 'webp';
  requiresBgRemoval: boolean;
  quality?: number;
}

/**
 * Asset type → output spec mapping.
 * Deliver node uses this to decide post-processing (bg-removal, format conversion)
 * on finalImage only — sketches are saved as-is for selection preview.
 */
export const ASSET_OUTPUT_SPECS: Record<VisualAssetType, VisualOutputSpec> = {
  logo:         { format: 'png',  requiresBgRemoval: true },
  icon:         { format: 'png',  requiresBgRemoval: true },
  illustration: { format: 'png',  requiresBgRemoval: true },
  hero:         { format: 'jpeg', requiresBgRemoval: false, quality: 90 },
  general:      { format: 'jpeg', requiresBgRemoval: false, quality: 85 },
};

/**
 * Dependencies for visual graph nodes
 */
export interface VisualGraphDeps {
  llm: LLMClient;
  directLLM: LLMClient;
  explainLLM: LLMClient;
  engraveLLM: LLMClient;
  sketchImageClient: ImageGenerationPort;
  renderImageClient: ImageGenerationPort;
  promptBuilder: import('../../../../core/prompt/builder/PromptBuilder').PromptBuilder;
  session: any;
  kanbanUpdate?: TaskQueueUpdatePort;
  fileTreeUpdate?: FileTreeUpdatePort;
  workflowUpdate?: WorkflowStateUpdatePort;
  backgroundRemoval?: BackgroundRemovalPort;
}

/**
 * Visual Graph State — conforms to DetectableState (extends TriageableState)
 */
export interface VisualGraphState extends DetectableState, PhaseTrackingState {
  // TriageableState overrides
  featurePath: string;
  context: TriageableContext;
  deps: VisualGraphDeps;
  currentAgent: string;
  currentJob: string;

  // Unified conversations record
  conversations: Conversations;
  engineeredPrompt?: string;
  sketchImages?: SketchImage[];
  svgSketches?: SvgSketch[];
  selectedSketchIndex?: number;
  finalImage?: GeneratedImage;
  outputPath?: string;

  // Asset classification & job mode
  assetType?: VisualAssetType;
  jobMode?: Mode;
  skipClassify?: boolean;

  // resolvedAction inherited from DetectableState

  // Session carry-over (preserved across invocations)
  lastEngineeredPrompt?: string;
  lastOutputPath?: string;

  // LLM-resolved parameters (from direct node, take priority over defaults)
  resolvedAspectRatio?: string;
  availableSketchPaths?: string[];

  // Per-sketch variation prompts (from direct node for sketch/engrave routes)
  basePrompt?: string;
  sketchVariations?: SketchVariation[];
  variationAxis?: string;

  // Clarify counter (hard limit to prevent infinite clarify loops)
  clarifyCount?: number;

  // Sketch selection intent (set by resolve from overrideDirective prefix)
  sketchIntent?: 'finalize' | 'regenerate' | 'feedback';

  // Control flow
  routeDecision?: 'sketch' | 'render' | 'engrave' | 'clarify' | 'end' | 'deliver';
  needsSketches?: boolean;
  isSvgRequest?: boolean;

  // Error handling
  visualError?: string;
  safetyBlocked?: boolean;

  // Settings
  visualSettings?: VisualSettings;

  // Session & timing
  isResume?: boolean;
  _phaseTimings?: Record<string, number>;
  _uiLocale?: string;

  // Persist pruning metadata (set by direct, consumed by graph.ts session save)
  _conversationCompaction?: ConversationCompaction;

  // Pending tool calls (TriageableState compat)
  pendingToolCalls?: any[];
}

export const VisualGraphAnnotation = Annotation.Root({
  ...DetectableFields,
  engineeredPrompt: Annotation<any>,
  sketchImages: Annotation<any>,
  svgSketches: Annotation<any>,
  selectedSketchIndex: Annotation<any>,
  finalImage: Annotation<any>,
  outputPath: Annotation<any>,
  assetType: Annotation<any>,
  jobMode: Annotation<any>,
  skipClassify: Annotation<any>,
  lastEngineeredPrompt: Annotation<any>,
  lastOutputPath: Annotation<any>,
  resolvedAspectRatio: Annotation<any>,
  availableSketchPaths: Annotation<any>,
  basePrompt: Annotation<any>,
  sketchVariations: Annotation<any>,
  variationAxis: Annotation<any>,
  clarifyCount: Annotation<any>,
  sketchIntent: Annotation<any>,
  routeDecision: Annotation<any>,
  needsSketches: Annotation<any>,
  isSvgRequest: Annotation<any>,
  visualError: Annotation<any>,
  safetyBlocked: Annotation<any>,
  visualSettings: Annotation<any>,
  _conversationCompaction: Annotation<any>,
  phaseTokenUsages: Annotation<any>,
  pendingToolCalls: Annotation<any>,
} as const);

/**
 * Params for runVisualGraph
 */
export interface RunVisualGraphParams {
  directive: string;
  featurePath: string;
  isResume?: boolean;
  chatSource?: boolean;
  skipTriage?: boolean;
  actionMetadata?: import('@ant/shared').ActionMetadata;
  deps: VisualGraphDeps;
  visualSettings?: VisualSettings;
  _httpJobId?: string;
}
