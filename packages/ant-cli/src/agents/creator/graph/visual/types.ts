/**
 * Visual Graph State Types
 *
 * Defines the state shape for the visual job LangGraph,
 * conforming to TriageableState for triage node compatibility.
 */

import { TriageableState, TriageResult, WorkspaceState } from '../../../common/nodes/triage/types.js';
import { LLMClient } from '../../../../core/ports/llm.js';
import { ImageGenerationPort, GeneratedImage } from '../../../../core/ports/imageGeneration.js';
import { BackgroundRemovalPort } from '../../../../core/ports/backgroundRemoval.js';
import { PromptPort } from '../../../../core/ports/prompt.js';
import { TaskQueueUpdatePort, FileTreeUpdatePort } from '../../../../core/ports/index.js';
import { WorkflowStateUpdatePort } from '../../../../core/ports/workflow.js';
import { TokenUsage, PhaseTrackingState } from '../../../common/graph/llmHelpers.js';
import { VisualSettings } from '../../../../core/types/workspace.js';
import type { ConversationEntry } from '../../../../core/types/session.js';
import type { ConversationCompaction } from '../../../../core/context/compactJob.js';
import type { JobMode } from '@ant/shared';

export type { JobMode };

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

/**
 * Normalized asset type for conditional prompt injection
 */
export type VisualAssetType = 'logo' | 'icon' | 'hero' | 'illustration' | 'general';

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
  promptPort: PromptPort;
  session: any;
  kanbanUpdate?: TaskQueueUpdatePort;
  fileTreeUpdate?: FileTreeUpdatePort;
  workflowUpdate?: WorkflowStateUpdatePort;
  backgroundRemoval?: BackgroundRemovalPort;
}

/**
 * Visual Graph State — conforms to TriageableState
 */
export interface VisualGraphState extends TriageableState, PhaseTrackingState {
  // TriageableState fields
  featurePath: string;
  context: any;
  directive?: string;
  deps: VisualGraphDeps;
  _httpJobId?: string;
  tokenUsage?: TokenUsage;
  skipTriage?: boolean;
  triageResult?: TriageResult;
  workspaceState?: WorkspaceState;
  currentAgent: string;
  currentJob: string;
  overrideDirective?: string;
  chatSource?: boolean;

  // Visual-specific state
  conversation: ConversationEntry[];
  engineeredPrompt?: string;
  sketchImages?: SketchImage[];
  svgSketches?: SvgSketch[];
  selectedSketchIndex?: number;
  finalImage?: GeneratedImage;
  outputPath?: string;

  // Asset classification & job mode
  assetType?: VisualAssetType;
  jobMode?: JobMode;
  skipClassify?: boolean;

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
