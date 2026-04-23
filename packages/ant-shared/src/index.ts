/**
 * @ant/shared - Shared Types
 * 
 * Single source of truth for types that cross the BE↔FE boundary.
 * Both @ant/cli and @ant/ui import from this package.
 * 
 * Modules:
 *   - job.ts                : JobType, DecomposableJobType, SessionableJobType, JobTiming
 *   - task.ts               : TaskType, BaseTask, KanbanData, TaskTiming, TaskTokenUsage
 *   - interruption.ts       : InterruptionReason, InterruptionDetails
 *   - detection.ts          : Mode, IntentGroup, DesignDomain, InferredAction
 *   - rac.ts                : ResolvedActionContext, TechTier, ResolvedArtifact, resolveToRAC, mergeWithMetadata, buildTechTier
 *   - actions.ts            : IntentId, ActionMetadata, deriveFromIntent, INTENT_DEFINITIONS
 *   - action-config-matrix.ts : ConfigSlots, getConfigSlots
 *   - workflow.ts           : WorkflowRealtimeState, NodeHistoryEntry, TaskInfo
 *   - figma.ts              : FigmaDataConfig, FigmaExplorationResult
 *   - bridge.ts             : BridgeMessage, BridgeSession
 *   - canonical.ts          : CANONICAL_FEATURE_DIRS, isCanonicalDir
 *   - file-descriptions.ts  : FILE_DESCRIPTIONS
 *   - deploy.ts             : DeployConfig
 *   - git.ts                : GitStatusResponse, GitChangesResponse, FileChange
 *   - file-resource.ts      : FileResource, FileResourceMeta, FileNode, TemplateReason
 */

export * from './job';
export * from './task';
export * from './interruption';
export * from './detection';
export * from './workflow';
export * from './figma';
export * from './bridge';
export * from './canonical';
export * from './actions';
export * from './action-config-matrix';
export * from './file-descriptions';
export * from './tech-tier-registry';
export * from './visual-tier-registry';
export * from './rac';
export * from './prompt-policy-matrix';
export * from './deploy';
export * from './sse-events';
export * from './verification-scenario';
export * from './git';
export * from './session-log';
export * from './file-resource';
