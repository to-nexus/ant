/**
 * PortRegistryPort
 * 
 * Interface for storing port mappings.
 * Allows different implementations (in-memory, Redis, etc.)
 */

export interface PortMapping {
  tenantId: string;     // Organization ID
  userId: string;       // User ID within the organization
  projectId: string;    // Project ID
  feature: string;      // Branch name, feature name, or work identifier
  port: number;
  registeredAt: Date;
  lastAccessedAt: Date;
}

export interface PortRegistryPort {
  /**
   * Register a dev server port mapping
   * @param tenantId - Organization/tenant identifier
   * @param userId - User identifier within the organization
   * @param projectId - Project identifier
   * @param feature - Feature/branch identifier
   * @param port - Port number
   */
  registerDevServer(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    port: number
  ): Promise<void>;

  /**
   * Register an IDE port mapping
   */
  registerIDE(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    port: number
  ): Promise<void>;

  /**
   * Get dev server port
   * @returns Port number or null if not found
   */
  getDevServerPort(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<number | null>;

  /**
   * Get IDE port
   */
  getIDEPort(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<number | null>;

  /**
   * Unregister dev server
   */
  unregisterDevServer(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<void>;

  /**
   * Unregister IDE
   */
  unregisterIDE(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<void>;

  /**
   * List all active dev servers
   */
  listDevServers(): Promise<PortMapping[]>;

  /**
   * List all active IDEs
   */
  listIDEs(): Promise<PortMapping[]>;

  /**
   * Update last accessed time (for idle detection)
   */
  updateLastAccess(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    type: 'dev-server' | 'ide'
  ): Promise<void>;

  /**
   * Cleanup (close connections, etc.)
   */
  close(): Promise<void>;
}

