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
  image: 'codercom/code-server:latest',
  cpuLimit: '2',
  memoryLimit: '4Gi',
  idleTimeoutMs: 30 * 60 * 1000  // 30 minutes
};

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

  /**
   * Create instance key
   */
  private createInstanceKey(tenantId: string, projectId: string, feature: string): string {
    return `${tenantId}:${projectId}:${feature}`;
  }

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
    timeoutMs: number = 10000
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
    
    console.log(`[KubernetesIDEOrchestrator] K8s API: ${method} ${path} (host=${apiHost}, port=${apiPort}, hasCaCert=${!!caCert}, hasToken=${!!token})`);
    
    // Use https for in-cluster, http for local kubectl proxy
    const useHttps = isInCluster || !!this.options.kubeApiUrl;
    const protocol = useHttps ? https : http;

    return new Promise((resolve, reject) => {
      const requestBody = body ? JSON.stringify(body) : undefined;
      
      const options: https.RequestOptions = {
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
          console.log(`[KubernetesIDEOrchestrator] K8s API response: ${res.statusCode} (${data.length} bytes)`);
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
        console.log(`[KubernetesIDEOrchestrator] K8s API TIMEOUT: ${method} ${path}`);
        req.destroy();
        reject(new Error(`K8s API request timeout: ${method} ${path}`));
      });

      req.on('error', (err) => {
        console.log(`[KubernetesIDEOrchestrator] K8s API ERROR: ${err.message}`);
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
          name: 'code-server',
          image: this.options.image,
          ports: [{ containerPort: 8080 }],
          env: [
            { name: 'PASSWORD', value: 'ant-ide' },  // TODO: Generate secure password
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
        ports: [{ port: 8080, targetPort: 8080 }],
        type: 'ClusterIP'
      }
    };
  }

  // ============================================
  // IDEOrchestratorPort Implementation
  // ============================================

  async start(params: IDEParams): Promise<IDEStartResult> {
    const { userContext, projectId, workspacePath, feature = 'main' } = params;
    const tenantId = `${userContext.organizationId}:${userContext.userId}`;
    const instanceKey = this.createInstanceKey(tenantId, projectId, feature);
    const resourceName = this.createResourceName(instanceKey);

    console.log(`[KubernetesIDEOrchestrator] ▶ START request received: ${instanceKey}`);
    logger.info(`[KubernetesIDEOrchestrator] Starting K8s IDE: ${instanceKey}`, {
      component: 'KubernetesIDEOrchestrator',
      organizationId: userContext.organizationId,
      userId: userContext.userId,
      projectId,
      resourceName,
      namespace: this.options.namespace
    });

    try {
      // Check if pod already exists
      console.log(`[KubernetesIDEOrchestrator] Checking if pod exists: ${resourceName}`);
      const existingPod = await this.getPodIfExists(resourceName);
      console.log(`[KubernetesIDEOrchestrator] Pod exists check result: ${existingPod ? 'exists' : 'not found'}`);
      
      if (existingPod) {
        // Pod exists - check status
        console.log(`[KubernetesIDEOrchestrator] Pod status: phase=${existingPod.status?.phase}, deletionTimestamp=${existingPod.metadata?.deletionTimestamp || 'none'}`);
        
        if (existingPod.metadata?.deletionTimestamp) {
          // Pod is being deleted - wait for deletion then recreate
          console.log(`[KubernetesIDEOrchestrator] Pod is being deleted, waiting...`);
          await this.waitForPodDeletion(resourceName);
        } else if (existingPod.status?.phase === 'Running') {
          // Pod is running - return existing instance
          console.log(`[KubernetesIDEOrchestrator] Pod already running, calling createInstanceResult()`);
          return this.createInstanceResult(existingPod, tenantId, userContext, projectId, feature, instanceKey);
        } else {
          // Pod exists but not running (Failed, Pending, etc) - delete and recreate
          console.log(`[KubernetesIDEOrchestrator] Pod exists but not running (${existingPod.status?.phase}), recreating`);
          await this.deleteResources(resourceName);
          await this.waitForPodDeletion(resourceName);
        }
      }

      // Create Pod
      console.log(`[KubernetesIDEOrchestrator] Creating Pod: ${resourceName} in namespace ${this.options.namespace}`);
      const podSpec = this.createPodSpec(instanceKey, resourceName, workspacePath, userContext);
      await this.k8sRequest(
        `/api/v1/namespaces/${this.options.namespace}/pods`,
        'POST',
        podSpec
      );
      console.log(`[KubernetesIDEOrchestrator] Pod created: ${resourceName}`);

      // Create Service (ignore if already exists)
      console.log(`[KubernetesIDEOrchestrator] Creating Service: ${resourceName}`);
      const serviceSpec = this.createServiceSpec(instanceKey, resourceName);
      try {
        await this.k8sRequest(
          `/api/v1/namespaces/${this.options.namespace}/services`,
          'POST',
          serviceSpec
        );
        console.log(`[KubernetesIDEOrchestrator] Service created: ${resourceName}`);
      } catch (e: any) {
        // Ignore 409 conflict for service (already exists)
        if (!e.message?.includes('409')) throw e;
        console.log(`[KubernetesIDEOrchestrator] Service already exists: ${resourceName}`);
      }

      // Wait for pod to be ready (simplified)
      console.log(`[KubernetesIDEOrchestrator] Waiting for Pod to be ready: ${resourceName}`);
      await this.waitForPodReady(resourceName);
      console.log(`[KubernetesIDEOrchestrator] Pod is ready: ${resourceName}`);

      // Get pod info
      const pod = await this.k8sRequest<K8sPod>(
        `/api/v1/namespaces/${this.options.namespace}/pods/${resourceName}`
      );

      // Register in state store
      await this.stateStore.registerIDE(
        tenantId,
        userContext.userId,
        projectId,
        feature,
        8080,
        pod.status?.podIP || resourceName
      );

      const instance: IDEInstance = {
        instanceId: resourceName,
        host: pod.status?.podIP || resourceName,
        port: 8080,
        url: `/ide/${instanceKey}`,
        workspacePath: '/workspace',
        status: 'running',
        tenantId,
        userId: userContext.userId,
        projectId,
        feature,
        createdAt: new Date(),
        lastAccessedAt: new Date()
      };

      console.log(`[KubernetesIDEOrchestrator] ✅ IDE started successfully: ${instanceKey} (host=${instance.host})`);
      return {
        success: true,
        instance
      };
    } catch (error: any) {
      console.log(`[KubernetesIDEOrchestrator] ❌ Failed to start IDE: ${instanceKey} - ${error.message}`);
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
  private async waitForPodReady(resourceName: string, timeoutMs: number = 60000): Promise<void> {
    const startTime = Date.now();
    
    logger.info(`Waiting for pod ${resourceName} to be ready (timeout: ${timeoutMs}ms)`, {
      component: 'KubernetesIDEOrchestrator'
    });
    
    while (Date.now() - startTime < timeoutMs) {
      try {
        const pod = await this.k8sRequest<K8sPod>(
          `/api/v1/namespaces/${this.options.namespace}/pods/${resourceName}`
        );

        logger.debug(`Pod ${resourceName} status: phase=${pod.status?.phase}`, {
          component: 'KubernetesIDEOrchestrator',
          podStatus: JSON.stringify(pod.status)
        });

        if (pod.status?.phase === 'Running') {
          logger.info(`Pod ${resourceName} is ready`, {
            component: 'KubernetesIDEOrchestrator'
          });
          return;
        }

        if (pod.status?.phase === 'Failed') {
          throw new Error('Pod failed to start');
        }
      } catch (error: any) {
        if (!error.message.includes('404')) {
          logger.warn(`Error checking pod ${resourceName}: ${error.message}`, {
            component: 'KubernetesIDEOrchestrator'
          });
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
  private async waitForPodDeletion(resourceName: string, timeoutMs: number = 30000): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      const pod = await this.getPodIfExists(resourceName);
      if (!pod) {
        return; // Pod deleted
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
    console.log(`[KubernetesIDEOrchestrator] createInstanceResult() called for pod ${pod.metadata.name}, IP=${pod.status?.podIP}`);
    
    // Update last access time in state store
    console.log(`[KubernetesIDEOrchestrator] Calling stateStore.registerIDE()...`);
    await this.stateStore.registerIDE(
      tenantId,
      userContext.userId,
      projectId,
      feature,
      8080,
      pod.status?.podIP || pod.metadata.name
    );
    console.log(`[KubernetesIDEOrchestrator] stateStore.registerIDE() completed`);

    const instance: IDEInstance = {
      instanceId: pod.metadata.name,
      host: pod.status?.podIP || pod.metadata.name,
      port: 8080,
      url: `/ide/${instanceKey}`,
      workspacePath: '/workspace',
      status: 'running',
      tenantId,
      userId: userContext.userId,
      projectId,
      feature,
      createdAt: new Date(),
      lastAccessedAt: new Date()
    };

    console.log(`[KubernetesIDEOrchestrator] ✅ createInstanceResult() returning success, host=${instance.host}, port=${instance.port}`);
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
    const instanceKey = this.createInstanceKey(tenantId, projectId, feature);
    const resourceName = this.createResourceName(instanceKey);

    logger.info(`Stopping K8s IDE: ${instanceKey}`, {
      component: 'KubernetesIDEOrchestrator'
    });

    try {
      await this.deleteResources(resourceName);

      // Extract userId from tenantId (format: orgId:userId)
      const parts = tenantId.split(':');
      const userId = parts.length > 1 ? parts[1] : '';

      await this.stateStore.unregisterIDE(tenantId, userId, projectId, feature);

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
    const instanceKey = this.createInstanceKey(tenantId, projectId, feature);
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
        port: 8080,
        url: `/ide/${instanceKey}`,
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
        const parts = instanceKey.split(':');

        return {
          instanceId: pod.metadata.name,
          host: pod.status?.podIP || pod.metadata.name,
          port: 8080,
          url: `/ide/${instanceKey}`,
          workspacePath: pod.metadata.annotations?.['ant.io/workspace-path'] || '/workspace',
          status: (pod.status?.phase === 'Running' ? 'running' : 'starting') as IDEStatus,
          tenantId: parts[0] || '',
          projectId: parts[1] || '',
          feature: parts[2] || 'main'
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
        const parts = instanceKey.split(':');

        return {
          instanceId: pod.metadata.name,
          host: pod.status?.podIP || pod.metadata.name,
          port: 8080,
          url: `/ide/${instanceKey}`,
          workspacePath: pod.metadata.annotations?.['ant.io/workspace-path'] || '/workspace',
          status: (pod.status?.phase === 'Running' ? 'running' : 'starting') as IDEStatus,
          tenantId: parts[0] || '',
          userId: userContext.userId,
          projectId: parts[1] || '',
          feature: parts[2] || 'main'
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
    const instances = await this.list();
    const now = Date.now();

    for (const instance of instances) {
      // Check last access time from state store
      const portMapping = await this.stateStore.getIDE(
        instance.tenantId,
        instance.userId || '',
        instance.projectId,
        instance.feature || 'main'
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
