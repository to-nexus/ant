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
import { TokenUsage } from '../../../common/graph/llmHelpers.js';
import { VisualSettings } from '../../../../core/types/workspace.js';
import type { JobMode } from '@ant/shared';

export type { JobMode };

/**
 * Conversation entry for multi-turn visual context
 */
export interface VisualConversationEntry {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  metadata?: {
    savedAsset?: string;
    chapterSummary?: string;
  };
}

/**
 * Draft image with full parameter preservation for render step
 */
export interface DraftImage {
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
 * SVG draft for engrave node
 */
export interface SvgDraft {
  code: string;
  prompt: string;
  index: number;
}

/**
 * Per-draft variation: direction-specific prompt suffix + UI label
 */
export interface DraftVariation {
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
 * on finalImage only — drafts are saved as-is for selection preview.
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
export interface VisualGraphState extends TriageableState {
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
  conversation: VisualConversationEntry[];
  engineeredPrompt?: string;
  draftImages?: DraftImage[];
  svgDrafts?: SvgDraft[];
  selectedDraftIndex?: number;
  finalImage?: GeneratedImage;
  outputPath?: string;

  // Asset classification & job mode
  assetType?: VisualAssetType;
  jobMode?: JobMode;
  skipClassify?: boolean;

  // Session carry-over (preserved across invocations for refactor mode)
  lastEngineeredPrompt?: string;
  lastOutputPath?: string;

  // LLM-resolved parameters (from direct node, take priority over defaults)
  resolvedAspectRatio?: string;
  availableDraftPaths?: string[];

  // Per-draft variation prompts (from direct node for sketch/engrave routes)
  basePrompt?: string;
  draftVariations?: DraftVariation[];
  variationAxis?: string;

  // Clarify counter (hard limit to prevent infinite clarify loops)
  clarifyCount?: number;

  // Draft selection intent (set by resolve from overrideDirective prefix)
  draftIntent?: 'finalize' | 'regenerate' | 'refine_explore' | 'refine_finalize';
  isDraftFeedback?: boolean;

  // Control flow
  routeDecision?: 'sketch' | 'render' | 'engrave' | 'clarify' | 'end';
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
  deps: VisualGraphDeps;
  visualSettings?: VisualSettings;
  _httpJobId?: string;
}
