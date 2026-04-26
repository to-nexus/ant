/**
 * Core Types - Barrel Export
 * 
 * Single import point for all core type modules.
 * Import from '@core/types' or '../../core/types' to access any core type.
 * 
 * Type Modules:
 *   - agent.ts     : AgentJob, CodebaseProfile, ProjectContext, CollectionType
 *   - session.ts   : Session, SessionState, SessionRun, InterruptionDetails
 *   - task.ts      : JobType, TaskType, BaseTask, KanbanData, TaskQueueSnapshot
 *   - workspace.ts : WorkspaceConfig, FeatureConfig
 *   - environment.ts: EnvironmentDetection
 *   - detection.ts : Mode, IntentGroup, InferredAction
 *   - designDoc.ts : ParsedDesignDocs, DesignDocSection (UI + GameArt surfaces)
 *   - uiDoc.ts     : DEPRECATED re-export shim of designDoc (Phase 2)
 *   - user.ts      : UserContext
 *   - processEnv.ts: CHILD_PROCESS_ENV
 */

// Agent & project types
export * from './types/agent';

// Session & interruption types
export * from './types/session';

// Task, Kanban, Job types (single source of truth)
export * from './types/task';

// Workspace types
export * from './types/workspace';

// Environment types
export * from './types/environment';

// Design document types (UI + GameArt surfaces — D24/D25)
export * from './types/designDoc';

// UI document types — DEPRECATED shim (re-exports designDoc aliases)
export * from './types/uiDoc';

// Detection types
export * from './types/detection';

// User context
export * from './types/user';

// Process env constants
export * from './types/processEnv';
