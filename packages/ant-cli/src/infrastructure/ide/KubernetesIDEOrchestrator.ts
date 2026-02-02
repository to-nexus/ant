/**
 * KubernetesIDEOrchestrator
 * 
 * Kubernetes-based implementation of IDEOrchestratorPort.
 * Manages IDE instances as K8s pods with isolated environments.
 * 
 * Features:
 * - Dynamic pod creation/deletion
 * - Resource limits (CPU, Memory)
 * - Persistent volume claims for workspace
 * - Ingress-based routing
 * - Automatic idle termination
 * 
 * Requirements:
 * - Kubernetes cluster access (in-cluster or kubeconfig)
 * - Namespace with appropriate RBAC
 * - code-server container image
 * 
 * @see 10-cloud-scalability-design.md Section 3.2.4
 */

import {
  IDEOrchestratorPort,
  IDEParams,
  IDEStartResult,
  IDEInstance,
  IDEStatus
} from '../../core/ports/ideOrchestrator';
import { StateStorePort } from '../../core/ports/stateStore';
import { UserContext } from '../../core/types/user';
import { createIDEKey, parseIDEKey } from '../state/redisKeyUtils';
import { logger } from '../../utils/logger';

// ============================================
// Kubernetes Types (simplified, avoid @kubernetes/client-node dependency)
// ============================================

interface K8sMetadata {
  name: string;
  namespace: string;
  labels: Record<string, string>;
  annotations?: Record<string, string>;
  deletionTimestamp?: string;  // Set when pod is being deleted
}

interface K8sPod {
  metadata: K8sMetadata;
  spec: {
    containers: Array<{
      name: string;
      image: string;
      ports: Array<{ containerPort: number }>;
      command?: string[];
      args?: string[];
      env?: Array<{ name: string; value: string }>;
      resources?: {
        limits?: { cpu?: string; memory?: string };
        requests?: { cpu?: string; memory?: string };
      };
      volumeMounts?: Array<{ name: string; mountPath: string }>;
    }>;
    volumes?: Array<{
      name: string;
      persistentVolumeClaim?: { claimName: string };
      emptyDir?: {};
    }>;
  };
  status?: {
    phase: 'Pending' | 'Running' | 'Succeeded' | 'Failed' | 'Unknown';
    podIP?: string;
    containerStatuses?: Array<{
      state?: {
        waiting?: { reason?: string; message?: string };
        terminated?: { reason?: string };
      };
    }>;
  };
}

interface K8sService {
  metadata: K8sMetadata;
  spec: {
    selector: Record<string, string>;
    ports: Array<{ port: number; targetPort: number }>;
    type: 'ClusterIP' | 'NodePort' | 'LoadBalancer';
  };
}

// ============================================
// Configuration
// ============================================

export interface KubernetesIDEOrchestratorOptions {
  namespace?: string;
  image?: string;
  cpuLimit?: string;
  memoryLimit?: string;
  idleTimeoutMs?: number;
  kubeApiUrl?: string;  // For out-of-cluster access
  kubeToken?: string;   // Service account token
}

const DEFAULT_OPTIONS: Required<Omit<KubernetesIDEOrchestratorOptions, 'kubeApiUrl' | 'kubeToken'>> = {
  namespace: 'ant-ide',
  // Use same image as IDEService (Docker) for consistency
  // openvscode-server: VS Code's open-source server, no built-in auth required
  image: process.env.ANT_IDE_IMAGE || 'gitpod/openvscode-server:latest',
  cpuLimit: '2',
  memoryLimit: '4Gi',
  idleTimeoutMs: 30 * 60 * 1000  // 30 minutes
};

// ============================================
// Timeout Constants
// ============================================

const TIMEOUTS = {
  /** K8s API request timeout (ms) */
  K8S_API_REQUEST: 10000,
  /** Pod ready wait timeout (ms) */
  POD_READY: 120000,
  /** Pod deletion wait timeout (ms) */
  POD_DELETION: 30000,
  /** State store operation timeout (ms) */
  STATE_STORE: 5000
} as const;

/** OpenVSCode Server port (same as IDEService for Docker) */
const IDE_PORT = 3000;

// ============================================
// Redis Keys for State
// ============================================

const KEYS = {
  IDE_INSTANCE: 'ant:ide:instance:',
  IDE_LAST_ACCESS: 'ant:ide:lastAccess:'
} as const;

// ============================================
// KubernetesIDEOrchestrator
// ============================================

export class KubernetesIDEOrchestrator implements IDEOrchestratorPort {
  private options: Required<Omit<KubernetesIDEOrchestratorOptions, 'kubeApiUrl' | 'kubeToken'>> & 
    Pick<KubernetesIDEOrchestratorOptions, 'kubeApiUrl' | 'kubeToken'>;
  private stateStore: StateStorePort;
  private idleCheckTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: KubernetesIDEOrchestratorOptions, stateStore: StateStorePort) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.stateStore = stateStore;

    logger.info(`KubernetesIDEOrchestrator initialized in namespace: ${this.options.namespace}`, {
      component: 'KubernetesIDEOrchestrator'
    });
  }

  // Instance key creation uses createIDEKey from ideKeyUtils.ts
  // Format: org:user:project (3 parts)

  /**
   * Create safe K8s resource name from instance key
   */
  private createResourceName(instanceKey: string): string {
    return `ide-${instanceKey.replace(/[^a-z0-9-]/g, '-').toLowerCase()}`.substring(0, 63);
  }

  /**
   * Make K8s API request using https module with ServiceAccount CA certificate
   */
  private async k8sRequest<T>(
    path: string,
    method: 'GET' | 'POST' | 'DELETE' = 'GET',
    body?: any,
    timeoutMs: number = TIMEOUTS.K8S_API_REQUEST
  ): Promise<T> {
    const https = await import('https');
    const http = await import('http');
    
    // Determine API URL
    const isInCluster = !!process.env.KUBERNETES_SERVICE_HOST;
    const apiHost = this.options.kubeApiUrl?.replace(/^https?:\/\//, '').split(':')[0] ||
      process.env.KUBERNETES_SERVICE_HOST || 'localhost';
    const apiPort = this.options.kubeApiUrl?.split(':')[2] ||
      process.env.KUBERNETES_SERVICE_PORT || '8001';

    // Get token and CA cert (in-cluster)
    const token = this.options.kubeToken || await this.readServiceAccountToken();
    const caCert = isInCluster ? await this.readServiceAccountCACert() : undefined;
    
    logger.debug(`K8s API: ${method} ${path}`, { component: 'KubernetesIDEOrchestrator' }, {
      apiHost,
      apiPort,
      hasCaCert: !!caCert,
      hasToken: !!token
    });
    
    // Use https for in-cluster, http for local kubectl proxy
    const useHttps = isInCluster || !!this.options.kubeApiUrl;
    const protocol = useHttps ? https : http;

    return new Promise((resolve, reject) => {
      const requestBody = body ? JSON.stringify(body) : undefined;
      
      const options: import('https').RequestOptions = {
        hostname: apiHost,
        port: parseInt(apiPort, 10),
        path,
        method,
        timeout: timeoutMs,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
          ...(requestBody ? { 'Content-Length': Buffer.byteLength(requestBody) } : {})
        },
        ...(caCert ? { ca: caCert } : {})
      };
      
      const req = protocol.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          logger.debug(`K8s API response: ${res.statusCode} (${data.length} bytes)`, {
            component: 'KubernetesIDEOrchestrator'
          });
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch {
              resolve(data as any);
            }
          } else {
            reject(new Error(`K8s API error: ${res.statusCode} - ${data}`));
          }
        });
      });

      req.on('timeout', () => {
        logger.warn(`K8s API timeout: ${method} ${path}`, { component: 'KubernetesIDEOrchestrator' });
        req.destroy();
        reject(new Error(`K8s API request timeout: ${method} ${path}`));
      });

      req.on('error', (err) => {
        logger.error(`K8s API error: ${err.message}`, { component: 'KubernetesIDEOrchestrator' }, err);
        reject(err);
      });
      
      if (requestBody) {
        req.write(requestBody);
      }
      req.end();
    });
  }

  /**
   * Read service account token (in-cluster)
   */
  private async readServiceAccountToken(): Promise<string | undefined> {
    try {
      const fs = await import('fs');
      return fs.readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/token', 'utf8');
    } catch {
      return undefined;
    }
  }

  /**
   * Read service account CA certificate (in-cluster)
   */
  private async readServiceAccountCACert(): Promise<string | undefined> {
    try {
      const fs = await import('fs');
      const cert = fs.readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/ca.crt', 'utf8');
      logger.debug(`Loaded ServiceAccount CA cert (${cert.length} bytes)`, {
        component: 'KubernetesIDEOrchestrator'
      });
      return cert;
    } catch (err: any) {
      logger.warn(`Failed to read ServiceAccount CA cert: ${err.message}`, {
        component: 'KubernetesIDEOrchestrator'
      });
      return undefined;
    }
  }

  /**
   * Create Pod spec
   */
  private createPodSpec(
    instanceKey: string,
    resourceName: string,
    workspacePath: string,
    userContext: UserContext
  ): K8sPod {
    return {
      metadata: {
        name: resourceName,
        namespace: this.options.namespace,
        labels: {
          'app': 'ant-ide',
          'instance': instanceKey.replace(/:/g, '-'),
          'user': userContext.userId
        },
        annotations: {
          'ant.io/instance-key': instanceKey,
          'ant.io/workspace-path': workspacePath
        }
      },
      spec: {
        containers: [{
          name: 'openvscode-server',
          image: this.options.image,
          ports: [{ containerPort: 3000 }],  // openvscode-server uses port 3000
          // Command to start openvscode-server without authentication
          // ANT already has Google OIDC auth at the API layer, so IDE-level auth is unnecessary
          command: ['/home/.openvscode-server/bin/openvscode-server'],
          args: ['--host', '0.0.0.0', '--without-connection-token'],
          env: [
            { name: 'ANT_WORKSPACE', value: '/workspace' }
          ],
          resources: {
            limits: {
              cpu: this.options.cpuLimit,
              memory: this.options.memoryLimit
            },
            requests: {
              cpu: '500m',
              memory: '512Mi'
            }
          },
          volumeMounts: [{
            name: 'workspace',
            mountPath: '/workspace'
          }]
        }],
        volumes: [{
          name: 'workspace',
          emptyDir: {}  // TODO: Use PVC for persistence
        }]
      }
    };
  }

  /**
   * Create Service spec
   */
  private createServiceSpec(instanceKey: string, resourceName: string): K8sService {
    return {
      metadata: {
        name: resourceName,
        namespace: this.options.namespace,
        labels: {
          'app': 'ant-ide',
          'instance': instanceKey.replace(/:/g, '-')
        }
      },
      spec: {
        selector: {
          'app': 'ant-ide',
          'instance': instanceKey.replace(/:/g, '-')
        },
        ports: [{ port: 3000, targetPort: 3000 }],
        type: 'ClusterIP'
      }
    };
  }

  // ============================================
  // IDEOrchestratorPort Implementation
  // ============================================

  async start(params: IDEParams): Promise<IDEStartResult> {
    const { userContext, projectId, workspacePath, feature = 'main' } = params;
    // Use centralized function for IDE instance key (org:user:project)
    const instanceKey = createIDEKey(userContext.organizationId, userContext.userId, projectId);
    const resourceName = this.createResourceName(instanceKey);

    // ✅ WARN level for production IDE debugging
    logger.warn(`Starting K8s IDE: ${instanceKey}`, {
      component: 'KubernetesIDEOrchestrator',
      organizationId: userContext.organizationId,
      userId: userContext.userId,
      projectId
    }, { resourceName, namespace: this.options.namespace });

    try {
      // Check if pod already exists
      logger.debug(`Checking if pod exists: ${resourceName}`, { component: 'KubernetesIDEOrchestrator' });
      const existingPod = await this.getPodIfExists(resourceName);
      logger.debug(`Pod exists check: ${existingPod ? 'exists' : 'not found'}`, { component: 'KubernetesIDEOrchestrator' });
      
      if (existingPod) {
        // Pod exists - check status
        logger.debug(`Pod status: phase=${existingPod.status?.phase}, deletionTimestamp=${existingPod.metadata?.deletionTimestamp || 'none'}`, {
          component: 'KubernetesIDEOrchestrator'
        });
        
        if (existingPod.metadata?.deletionTimestamp) {
          // Pod is being deleted - wait for deletion then recreate
          logger.info(`Pod is being deleted, waiting for deletion: ${resourceName}`, { component: 'KubernetesIDEOrchestrator' });
          await this.waitForPodDeletion(resourceName);
        } else if (existingPod.status?.phase === 'Running') {
          // Pod is running - return existing instance
          logger.info(`Pod already running, reusing: ${resourceName}`, { component: 'KubernetesIDEOrchestrator' });
          return this.createInstanceResult(existingPod, userContext.organizationId, userContext, projectId, feature, instanceKey);
        } else {
          // Pod exists but not running (Failed, Pending, etc) - delete and recreate
          logger.info(`Pod not running (${existingPod.status?.phase}), recreating: ${resourceName}`, { component: 'KubernetesIDEOrchestrator' });
          await this.deleteResources(resourceName);
          await this.waitForPodDeletion(resourceName);
        }
      }

      // Create Pod
      logger.info(`Creating Pod: ${resourceName} in namespace ${this.options.namespace}`, { component: 'KubernetesIDEOrchestrator' });
      const podSpec = this.createPodSpec(instanceKey, resourceName, workspacePath, userContext);
      await this.k8sRequest(
        `/api/v1/namespaces/${this.options.namespace}/pods`,
        'POST',
        podSpec
      );
      logger.debug(`Pod created: ${resourceName}`, { component: 'KubernetesIDEOrchestrator' });

      // Create Service (ignore if already exists)
      logger.debug(`Creating Service: ${resourceName}`, { component: 'KubernetesIDEOrchestrator' });
      const serviceSpec = this.createServiceSpec(instanceKey, resourceName);
      try {
        await this.k8sRequest(
          `/api/v1/namespaces/${this.options.namespace}/services`,
          'POST',
          serviceSpec
        );
        logger.debug(`Service created: ${resourceName}`, { component: 'KubernetesIDEOrchestrator' });
      } catch (e: any) {
        // Ignore 409 conflict for service (already exists)
        if (!e.message?.includes('409')) throw e;
        logger.debug(`Service already exists: ${resourceName}`, { component: 'KubernetesIDEOrchestrator' });
      }

      // Wait for pod to be ready
      logger.debug(`Waiting for Pod to be ready: ${resourceName}`, { component: 'KubernetesIDEOrchestrator' });
      await this.waitForPodReady(resourceName);
      logger.info(`Pod is ready: ${resourceName}`, { component: 'KubernetesIDEOrchestrator' });

      // Get pod info
      const pod = await this.k8sRequest<K8sPod>(
        `/api/v1/namespaces/${this.options.namespace}/pods/${resourceName}`
      );

      // Register in state store (IDE is project-level, no feature)
      await this.stateStore.registerIDE(
        userContext.organizationId,
        userContext.userId,
        projectId,
        IDE_PORT,
        pod.status?.podIP || resourceName
      );

      const instance: IDEInstance = {
        instanceId: resourceName,
        host: pod.status?.podIP || resourceName,
        port: IDE_PORT,
        url: `/api/ide/${instanceKey}`,
        workspacePath: '/workspace',
        status: 'running',
        tenantId: userContext.organizationId,
        userId: userContext.userId,
        projectId,
        feature,
        createdAt: new Date(),
        lastAccessedAt: new Date()
      };

      logger.warn(`IDE started successfully: ${instanceKey} (host=${instance.host})`, { component: 'KubernetesIDEOrchestrator' });
      return {
        success: true,
        instance
      };
    } catch (error: any) {
      logger.error(`Failed to start K8s IDE: ${instanceKey}`, {
        component: 'KubernetesIDEOrchestrator'
      }, error);

      // Cleanup on failure
      try {
        await this.deleteResources(resourceName);
      } catch {}

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Wait for pod to become ready
   */
  private async waitForPodReady(resourceName: string, timeoutMs: number = TIMEOUTS.POD_READY): Promise<void> {
    const startTime = Date.now();
    
    logger.debug(`Waiting for Pod to be ready: ${resourceName} (timeout: ${timeoutMs / 1000}s)`, {
      component: 'KubernetesIDEOrchestrator'
    });
    
    let lastPhase = '';
    while (Date.now() - startTime < timeoutMs) {
      try {
        const pod = await this.k8sRequest<K8sPod>(
          `/api/v1/namespaces/${this.options.namespace}/pods/${resourceName}`
        );

        const phase = pod.status?.phase || 'Unknown';
        const containerStatuses = pod.status?.containerStatuses?.[0];
        const waiting = containerStatuses?.state?.waiting;
        
        // Log only when phase changes or every 10 seconds
        const elapsed = Date.now() - startTime;
        if (phase !== lastPhase || elapsed % 10000 < 2000) {
          const waitReason = waiting ? ` (${waiting.reason}: ${waiting.message || 'no message'})` : '';
          logger.debug(`Pod ${resourceName}: phase=${phase}${waitReason} (${Math.round(elapsed / 1000)}s)`, {
            component: 'KubernetesIDEOrchestrator'
          });
          lastPhase = phase;
        }

        if (phase === 'Running') {
          logger.debug(`Pod is ready: ${resourceName}`, { component: 'KubernetesIDEOrchestrator' });
          return;
        }

        if (phase === 'Failed') {
          const reason = containerStatuses?.state?.terminated?.reason || 'Unknown';
          throw new Error(`Pod failed to start: ${reason}`);
        }
      } catch (error: any) {
        if (!error.message.includes('404')) {
          logger.warn(`Error checking pod: ${error.message}`, { component: 'KubernetesIDEOrchestrator' });
          throw error;
        }
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    throw new Error(`Pod ${resourceName} startup timeout after ${timeoutMs}ms`);
  }

  /**
   * Get pod if it exists, returns null if not found
   */
  private async getPodIfExists(resourceName: string): Promise<K8sPod | null> {
    try {
      return await this.k8sRequest<K8sPod>(
        `/api/v1/namespaces/${this.options.namespace}/pods/${resourceName}`
      );
    } catch (error: any) {
      if (error.message?.includes('404')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Wait for pod to be fully deleted
   */
  private async waitForPodDeletion(resourceName: string, timeoutMs: number = TIMEOUTS.POD_DELETION): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      const pod = await this.getPodIfExists(resourceName);
      if (!pod) {
        logger.debug(`Pod deleted: ${resourceName}`, { component: 'KubernetesIDEOrchestrator' });
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    throw new Error(`Timeout waiting for pod ${resourceName} to be deleted`);
  }

  /**
   * Create instance result from existing pod
   */
  private async createInstanceResult(
    pod: K8sPod,
    tenantId: string,
    userContext: UserContext,
    projectId: string,
    feature: string,
    instanceKey: string
  ): Promise<IDEStartResult> {
    logger.debug(`Creating instance result for pod ${pod.metadata.name}, IP=${pod.status?.podIP}`, {
      component: 'KubernetesIDEOrchestrator'
    });
    
    // Update last access time in state store (with timeout to prevent hanging)
    // IDE is project-level, no feature
    try {
      const registerPromise = this.stateStore.registerIDE(
        userContext.organizationId,
        userContext.userId,
        projectId,
        IDE_PORT,
        pod.status?.podIP || pod.metadata.name
      );
      
      // Timeout for Redis operation to prevent hanging
      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error('registerIDE timeout')), TIMEOUTS.STATE_STORE);
      });
      
      await Promise.race([registerPromise, timeoutPromise]);
      logger.debug(`stateStore.registerIDE() completed`, { component: 'KubernetesIDEOrchestrator' });
    } catch (err: any) {
      // Don't fail the whole operation if state store fails
      logger.warn(`stateStore.registerIDE() failed: ${err.message} - continuing anyway`, {
        component: 'KubernetesIDEOrchestrator'
      });
    }

    const instance: IDEInstance = {
      instanceId: pod.metadata.name,
      host: pod.status?.podIP || pod.metadata.name,
      port: IDE_PORT,
      url: `/api/ide/${instanceKey}`,
      workspacePath: '/workspace',
      status: 'running',
      tenantId,
      userId: userContext.userId,
      projectId,
      feature,
      createdAt: new Date(),
      lastAccessedAt: new Date()
    };

    logger.info(`Instance result created: host=${instance.host}, port=${instance.port}`, {
      component: 'KubernetesIDEOrchestrator'
    });
    return {
      success: true,
      instance
    };
  }

  /**
   * Delete pod and service
   */
  private async deleteResources(resourceName: string): Promise<void> {
    logger.info(`Deleting K8s resources: ${resourceName}`, {
      component: 'KubernetesIDEOrchestrator'
    });

    try {
      await this.k8sRequest(
        `/api/v1/namespaces/${this.options.namespace}/pods/${resourceName}`,
        'DELETE'
      );
      logger.info(`Pod ${resourceName} delete request sent`, {
        component: 'KubernetesIDEOrchestrator'
      });
    } catch (err: any) {
      // 404 is ok (already deleted)
      if (!err.message?.includes('404')) {
        logger.warn(`Failed to delete pod ${resourceName}: ${err.message}`, {
          component: 'KubernetesIDEOrchestrator'
        });
      }
    }

    try {
      await this.k8sRequest(
        `/api/v1/namespaces/${this.options.namespace}/services/${resourceName}`,
        'DELETE'
      );
      logger.info(`Service ${resourceName} delete request sent`, {
        component: 'KubernetesIDEOrchestrator'
      });
    } catch (err: any) {
      // 404 is ok (already deleted)
      if (!err.message?.includes('404')) {
        logger.warn(`Failed to delete service ${resourceName}: ${err.message}`, {
          component: 'KubernetesIDEOrchestrator'
        });
      }
    }
  }

  async stop(
    tenantId: string,
    projectId: string,
    feature: string = 'main'
  ): Promise<{ success: boolean; message?: string }> {
    // tenantId is in format org:user, parse it
    const tenantParts = tenantId.split(':');
    const orgId = tenantParts[0] || '';
    const userId = tenantParts.length > 1 ? tenantParts[1] : '';
    
    // Use centralized function for IDE instance key (org:user:project)
    const instanceKey = createIDEKey(orgId, userId, projectId);
    const resourceName = this.createResourceName(instanceKey);

    logger.info(`Stopping K8s IDE: ${instanceKey}`, {
      component: 'KubernetesIDEOrchestrator'
    });

    try {
      await this.deleteResources(resourceName);

      await this.stateStore.unregisterIDE(orgId, userId, projectId);

      return { success: true };
    } catch (error: any) {
      logger.error(`Failed to stop K8s IDE: ${instanceKey}`, {
        component: 'KubernetesIDEOrchestrator'
      }, error);

      return { success: false, message: error.message };
    }
  }

  async getStatus(
    tenantId: string,
    projectId: string,
    feature: string = 'main'
  ): Promise<IDEInstance | null> {
    // tenantId is in format org:user, parse it
    const tenantParts = tenantId.split(':');
    const orgId = tenantParts[0] || '';
    const userId = tenantParts.length > 1 ? tenantParts[1] : '';
    
    // Use centralized function for IDE instance key (org:user:project)
    const instanceKey = createIDEKey(orgId, userId, projectId);
    const resourceName = this.createResourceName(instanceKey);

    try {
      const pod = await this.k8sRequest<K8sPod>(
        `/api/v1/namespaces/${this.options.namespace}/pods/${resourceName}`
      );

      const status: IDEStatus = pod.status?.phase === 'Running' ? 'running' :
        pod.status?.phase === 'Pending' ? 'starting' :
        pod.status?.phase === 'Failed' ? 'error' : 'stopped';

      return {
        instanceId: resourceName,
        host: pod.status?.podIP || resourceName,
        port: IDE_PORT,
        url: `/api/ide/${instanceKey}`,
        workspacePath: '/workspace',
        status,
        tenantId,
        projectId,
        feature
      };
    } catch (error: any) {
      if (error.message.includes('404')) {
        return null;
      }
      throw error;
    }
  }

  async list(): Promise<IDEInstance[]> {
    try {
      const response = await this.k8sRequest<{ items: K8sPod[] }>(
        `/api/v1/namespaces/${this.options.namespace}/pods?labelSelector=app=ant-ide`
      );

      return response.items.map(pod => {
        const instanceKey = pod.metadata.annotations?.['ant.io/instance-key'] || pod.metadata.name;
        
        // Use centralized parsing function for IDE instance key
        const parsed = parseIDEKey(instanceKey);
        if (!parsed) {
          logger.warn(`Invalid IDE instance key format: ${instanceKey}`, { component: 'KubernetesIDEOrchestrator' });
          // Fallback for malformed keys
          return {
            instanceId: pod.metadata.name,
            host: pod.status?.podIP || pod.metadata.name,
            port: IDE_PORT,
            url: `/api/ide/${instanceKey}`,
            workspacePath: pod.metadata.annotations?.['ant.io/workspace-path'] || '/workspace',
            status: (pod.status?.phase === 'Running' ? 'running' : 'starting') as IDEStatus,
            tenantId: '',
            userId: '',
            projectId: instanceKey,
            feature: 'main'
          };
        }

        return {
          instanceId: pod.metadata.name,
          host: pod.status?.podIP || pod.metadata.name,
          port: IDE_PORT,
          url: `/api/ide/${instanceKey}`,
          workspacePath: pod.metadata.annotations?.['ant.io/workspace-path'] || '/workspace',
          status: (pod.status?.phase === 'Running' ? 'running' : 'starting') as IDEStatus,
          tenantId: parsed.tenantId,
          userId: parsed.userId,
          projectId: parsed.projectId,
          feature: 'main'  // IDE is project-level, always 'main'
        };
      });
    } catch (error: any) {
      logger.error('Failed to list K8s IDEs', { component: 'KubernetesIDEOrchestrator' }, error);
      return [];
    }
  }

  async listByUser(userContext: UserContext): Promise<IDEInstance[]> {
    try {
      const response = await this.k8sRequest<{ items: K8sPod[] }>(
        `/api/v1/namespaces/${this.options.namespace}/pods?labelSelector=app=ant-ide,user=${userContext.userId}`
      );

      return response.items.map(pod => {
        const instanceKey = pod.metadata.annotations?.['ant.io/instance-key'] || pod.metadata.name;
        
        // Use centralized parsing function for IDE instance key
        const parsed = parseIDEKey(instanceKey);
        if (!parsed) {
          logger.warn(`Invalid IDE instance key format: ${instanceKey}`, { component: 'KubernetesIDEOrchestrator' });
          // Fallback - use userContext for userId
          return {
            instanceId: pod.metadata.name,
            host: pod.status?.podIP || pod.metadata.name,
            port: IDE_PORT,
            url: `/api/ide/${instanceKey}`,
            workspacePath: pod.metadata.annotations?.['ant.io/workspace-path'] || '/workspace',
            status: (pod.status?.phase === 'Running' ? 'running' : 'starting') as IDEStatus,
            tenantId: userContext.organizationId,
            userId: userContext.userId,
            projectId: instanceKey,
            feature: 'main'
          };
        }

        return {
          instanceId: pod.metadata.name,
          host: pod.status?.podIP || pod.metadata.name,
          port: IDE_PORT,
          url: `/api/ide/${instanceKey}`,
          workspacePath: pod.metadata.annotations?.['ant.io/workspace-path'] || '/workspace',
          status: (pod.status?.phase === 'Running' ? 'running' : 'starting') as IDEStatus,
          tenantId: parsed.tenantId,
          userId: parsed.userId,
          projectId: parsed.projectId,
          feature: 'main'  // IDE is project-level, always 'main'
        };
      });
    } catch (error: any) {
      logger.error('Failed to list user K8s IDEs', { component: 'KubernetesIDEOrchestrator' }, error);
      return [];
    }
  }

  async cleanupProject(
    userContext: UserContext,
    projectId: string,
    options?: { deleteHome?: boolean }
  ): Promise<void> {
    const tenantId = `${userContext.organizationId}:${userContext.userId}`;
    
    logger.info(`Cleaning up K8s IDEs for project: ${projectId}`, {
      component: 'KubernetesIDEOrchestrator',
      projectId
    });

    // List all IDEs for this project
    const instances = await this.listByUser(userContext);
    const projectInstances = instances.filter(i => i.projectId === projectId);

    for (const instance of projectInstances) {
      await this.stop(tenantId, projectId, instance.feature || 'main');
    }
  }

  async cleanup(): Promise<void> {
    logger.info('Cleaning up all K8s IDE instances', {
      component: 'KubernetesIDEOrchestrator'
    });

    this.stopIdleCheck();

    // Delete all pods with our label
    try {
      const instances = await this.list();
      for (const instance of instances) {
        await this.deleteResources(instance.instanceId);
      }
    } catch (error: any) {
      logger.error('Failed to cleanup K8s IDEs', { component: 'KubernetesIDEOrchestrator' }, error);
    }
  }

  startIdleCheck(): void {
    if (this.idleCheckTimer) {
      return;
    }

    const checkInterval = 60000;  // Check every minute

    this.idleCheckTimer = setInterval(async () => {
      await this.checkIdleInstances();
    }, checkInterval);

    logger.info('Started idle check timer', { component: 'KubernetesIDEOrchestrator' });
  }

  stopIdleCheck(): void {
    if (this.idleCheckTimer) {
      clearInterval(this.idleCheckTimer);
      this.idleCheckTimer = null;
      logger.info('Stopped idle check timer', { component: 'KubernetesIDEOrchestrator' });
    }
  }

  /**
   * Check for idle instances and terminate them
   */
  private async checkIdleInstances(): Promise<void> {
    logger.warn(`[IdleCheck] Starting idle instance check...`, { component: 'KubernetesIDEOrchestrator' });
    
    const instances = await this.list();
    logger.warn(`[IdleCheck] Found ${instances.length} IDE instance(s)`, { component: 'KubernetesIDEOrchestrator' });
    
    const now = Date.now();

    for (const instance of instances) {
      // Skip instances with invalid key components (from malformed annotations)
      if (!instance.tenantId || !instance.userId || !instance.projectId) {
        logger.warn(`Skipping idle check for instance with invalid key: tenantId=${instance.tenantId}, userId=${instance.userId}, projectId=${instance.projectId}`, {
          component: 'KubernetesIDEOrchestrator'
        });
        continue;
      }
      
      // Check last access time from state store (IDE is project-level, no feature)
      const portMapping = await this.stateStore.getIDE(
        instance.tenantId,
        instance.userId,
        instance.projectId
      );

      if (portMapping) {
        const lastAccess = portMapping.lastAccessedAt?.getTime() || 0;
        const idleTime = now - lastAccess;

        if (idleTime > this.options.idleTimeoutMs) {
          logger.info(`Terminating idle K8s IDE: ${instance.instanceId}`, {
            component: 'KubernetesIDEOrchestrator'
          });

          await this.stop(
            instance.tenantId,
            instance.projectId,
            instance.feature || 'main'
          );
        }
      }
    }
  }
}
