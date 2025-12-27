/**
 * DevServerService Module
 * 
 * Re-export the main service for backward compatibility
 * Future: This will be refactored into multiple modules
 */

export { DevServerService } from './DevServerService';

// Export types
export * from './types';

// Export utilities
export * from './utils/serverKeyUtils';

// Export detectors
export { PackageDetector } from './detectors/PackageDetector';

// Export validators
export { ProjectValidator } from './validators/ProjectValidator';
export { ReactValidator } from './validators/ReactValidator';
export { VueValidator } from './validators/VueValidator';

// Export managers
export { LogManager } from './managers/LogManager';

