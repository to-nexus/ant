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
   * Make K8s API request
   */
  private async k8sRequest<T>(
    path: string,
    method: 'GET' | 'POST' | 'DELETE' = 'GET',
    body?: any
  ): Promise<T> {
    // Determine API URL
    const apiUrl = this.options.kubeApiUrl || 
      process.env.KUBERNETES_SERVICE_HOST 
        ? `https://${process.env.KUBERNETES_SERVICE_HOST}:${process.env.KUBERNETES_SERVICE_PORT}`
        : 'http://localhost:8001';  // kubectl proxy

    // Get token
    const token = this.options.kubeToken ||
      (process.env.KUBERNETES_SERVICE_HOST 
        ? await this.readServiceAccountToken()
        : undefined);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const url = `${apiUrl}${path}`;
    
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`K8s API error: ${response.status} - ${error}`);
    }

    return await response.json();
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

    logger.info(`Starting K8s IDE: ${instanceKey}`, {
      component: 'KubernetesIDEOrchestrator',
      organizationId: userContext.organizationId,
      userId: userContext.userId,
      projectId
    });

    try {
      // Create Pod
      const podSpec = this.createPodSpec(instanceKey, resourceName, workspacePath, userContext);
      await this.k8sRequest(
        `/api/v1/namespaces/${this.options.namespace}/pods`,
        'POST',
        podSpec
      );

      // Create Service
      const serviceSpec = this.createServiceSpec(instanceKey, resourceName);
      await this.k8sRequest(
        `/api/v1/namespaces/${this.options.namespace}/services`,
        'POST',
        serviceSpec
      );

      // Wait for pod to be ready (simplified)
      await this.waitForPodReady(resourceName);

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
  private async waitForPodReady(resourceName: string, timeoutMs: number = 60000): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      try {
        const pod = await this.k8sRequest<K8sPod>(
          `/api/v1/namespaces/${this.options.namespace}/pods/${resourceName}`
        );

        if (pod.status?.phase === 'Running') {
          return;
        }

        if (pod.status?.phase === 'Failed') {
          throw new Error('Pod failed to start');
        }
      } catch (error: any) {
        if (!error.message.includes('404')) {
          throw error;
        }
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    throw new Error('Pod startup timeout');
  }

  /**
   * Delete pod and service
   */
  private async deleteResources(resourceName: string): Promise<void> {
    try {
      await this.k8sRequest(
        `/api/v1/namespaces/${this.options.namespace}/pods/${resourceName}`,
        'DELETE'
      );
    } catch {}

    try {
      await this.k8sRequest(
        `/api/v1/namespaces/${this.options.namespace}/services/${resourceName}`,
        'DELETE'
      );
    } catch {}
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
