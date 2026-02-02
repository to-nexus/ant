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
  host?: string;        // Host (Pod IP for K8s, localhost for local)
  registeredAt: Date;
  lastAccessedAt: Date;
}

export interface PortRegistryPort {
  /**
   * Register a preview port mapping
   * @param tenantId - Organization/tenant identifier
   * @param userId - User identifier within the organization
   * @param projectId - Project identifier
   * @param feature - Feature/branch identifier
   * @param port - Port number
   * @param host - Host (Pod IP for K8s, localhost for local)
   */
  registerPreview(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    port: number,
    host?: string
  ): Promise<void>;

  /**
   * Register an IDE port mapping (IDE is project-level, no feature)
   */
  registerIDE(
    tenantId: string,
    userId: string,
    projectId: string,
    port: number
  ): Promise<void>;

  /**
   * Get preview port
   * @returns Port number or null if not found
   */
  getPreviewPort(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<number | null>;

  /**
   * Get IDE port (IDE is project-level, no feature)
   */
  getIDEPort(
    tenantId: string,
    userId: string,
    projectId: string
  ): Promise<number | null>;

  /**
   * Unregister preview
   */
  unregisterPreview(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<void>;

  /**
   * Unregister IDE (IDE is project-level, no feature)
   */
  unregisterIDE(
    tenantId: string,
    userId: string,
    projectId: string
  ): Promise<void>;

  /**
   * List all active previews
   */
  listPreviews(): Promise<PortMapping[]>;

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
    type: 'preview' | 'ide'
  ): Promise<void>;

  /**
   * Cleanup (close connections, etc.)
   */
  close(): Promise<void>;
}
