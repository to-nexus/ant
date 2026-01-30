/**
 * Adapter Factory Module
 * 
 * Exports adapters for CLI domain objects (Git, Memory, Chunk, etc.)
 */
export * from './AdapterFactory';

/**
 * Infrastructure Factory Module (Cloud Scalability)
 * 
 * Provides factory for creating infrastructure adapters.
 * All environments use the same distributed architecture (Redis, BullMQ, Remote Preview).
 * ANT_SERVER_MODE only affects authentication (local:local vs real auth).
 * 
 * @see 10-cloud-scalability-design.md Section 6.2
 */
export {
  InfrastructureFactory,
  getInfrastructureFactory,
  AuthMode,
  InfrastructureConfig
} from './InfrastructureFactory';
