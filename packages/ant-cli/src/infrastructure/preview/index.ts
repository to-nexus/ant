/**
 * Preview Orchestration Module
 * 
 * Exports preview orchestration implementations for ant-cli.
 * 
 * Usage:
 * - Local mode: LocalPreviewOrchestrator (wraps PreviewService)
 * - Cloud mode: RemotePreviewOrchestrator (remote workers)
 */

export { LocalPreviewOrchestrator } from './LocalPreviewOrchestrator';
export { RemotePreviewOrchestrator } from './RemotePreviewOrchestrator';
export type { RemotePreviewOrchestratorOptions } from './RemotePreviewOrchestrator';
export { PreviewWorkerService, startPreviewWorker } from './PreviewWorkerService';
export type { PreviewWorkerServiceOptions } from './PreviewWorkerService';

// Re-export types from port
export type {
  PreviewOrchestratorPort,
  PreviewParams,
  PreviewStartResult,
  PreviewInstance,
  PreviewStatus,
  PreviewIssue,
  PreviewLogEntry,
  PackageInfo
} from '../../core/ports/previewOrchestrator';
