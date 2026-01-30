/**
 * IDE Orchestration Module
 * 
 * Exports IDE orchestration implementations for ant-cli.
 * 
 * Usage:
 * - Local mode: LocalIDEOrchestrator (wraps IDEService with Docker)
 * - Cloud mode: KubernetesIDEOrchestrator (K8s pods)
 */

export { LocalIDEOrchestrator, DockerIDEOrchestrator } from './LocalIDEOrchestrator';
export { KubernetesIDEOrchestrator } from './KubernetesIDEOrchestrator';
export type { KubernetesIDEOrchestratorOptions } from './KubernetesIDEOrchestrator';

// Re-export types from port
export type {
  IDEOrchestratorPort,
  IDEParams,
  IDEStartResult,
  IDEInstance,
  IDEStatus
} from '../../core/ports/ideOrchestrator';
