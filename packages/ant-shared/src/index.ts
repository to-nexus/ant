/**
 * @ant/shared - Shared Types
 * 
 * Single source of truth for types that cross the BE↔FE boundary.
 * Both @ant/cli and @ant/ui import from this package.
 * 
 * Modules:
 *   - job.ts          : JobType, DecomposableJobType, SessionableJobType, JobTiming
 *   - task.ts         : TaskType, BaseTask, KanbanData, TaskTiming, TaskTokenUsage
 *   - interruption.ts : InterruptionReason, InterruptionDetails
 *   - detection.ts    : DetectionReport, JobMode, JobEnvironment
 *   - workflow.ts     : WorkflowRealtimeState, NodeHistoryEntry, TaskInfo
 */

export * from './job';
export * from './task';
export * from './interruption';
export * from './detection';
export * from './workflow';
export * from './figma';
export * from './bridge';
