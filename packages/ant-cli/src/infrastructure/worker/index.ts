/**
 * Worker Module
 * 
 * Exports worker implementations for distributed job processing.
 * 
 * Usage:
 * - In cloud mode, run JobWorker as a separate process
 * - Multiple workers can run in parallel for horizontal scaling
 */

export { JobWorker, startJobWorker } from './JobWorker';
export type { JobWorkerOptions } from './JobWorker';
