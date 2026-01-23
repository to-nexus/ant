/**
 * Adapter Factory Module
 * 
 * Exports adapters for CLI domain objects (Git, Memory, Chunk, etc.)
 */
export * from './AdapterFactory';

/**
 * Infrastructure Factory Module (Cloud Scalability)
 * 
 * Provides factory for creating cloud-scalable infrastructure adapters.
 * Mode is determined by single ANT_SERVER_MODE environment variable.
 * 
 * @see 10-cloud-scalability-design.md Section 6.2
 */
export {
  InfrastructureFactory,
  getInfrastructureFactory,
  ServerMode,
  InfrastructureConfig
} from './InfrastructureFactory';
