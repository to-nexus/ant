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
import { RESERVED_FEATURE_NAME } from '../../core/utils/branchUtils';
import { resolveK8sWorktreeMounts } from './k8sWorktreeMounts';
import { waitForHttpReady } from './readiness';

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
      workingDir?: string;
      ports: Array<{ containerPort: number }>;
      command?: string[];
      args?: string[];
      env?: Array<{ name: string; value: string }>;
      resources?: {
        limits?: { cpu?: string; memory?: string };
        requests?: { cpu?: string; memory?: string };
      };
      volumeMounts?: Array<{ name: string; mountPath: string; subPath?: string }>;
      readinessProbe?: {
        httpGet?: { path: string; port: number };
        initialDelaySeconds?: number;
        periodSeconds?: number;
        timeoutSeconds?: number;
        failureThreshold?: number;
        successThreshold?: number;
      };
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
    conditions?: Array<{
      type: string;
      status: string;
      reason?: string;
      message?: string;
    }>;
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
  idleTimeoutMs: 10 * 60 * 1000  // 10 minutes — counted from the last HTTP/WS hit through the IDE proxy
};

// EFS PVC configuration (default matches DevOps naming convention).
// Read lazily so tests can override env per case; production K8s sets env
// before the process starts so dynamic read costs nothing.
function getEfsPvcName(): string {
  return process.env.ANT_EFS_PVC_NAME || 'ant-workspaces-pvc';
}
function getWorkspaceBasePath(): string {
  return process.env.ANT_WORKSPACE_BASE_PATH || '/mnt/workspaces';
}

// ============================================
// Timeout Constants
// ============================================

const TIMEOUTS = {
  /** K8s API request timeout (ms) */
  K8S_API_REQUEST: 10000,
  /** Pod ready wait timeout (ms) - DevOps 권고: 노드 할당 + Pod 생성 시간 고려하여 4분 */
  POD_READY: 240000,
  /**
   * Pod deletion wait timeout (ms). Doubled (60s) so the wait outlives the
   * grace period (5s — see `POD_DELETION_GRACE_SECONDS`) plus kubelet teardown
   * margin. Closes the previous "grace == wait timeout" boundary collision
   * that allowed `fs.rm` to start while a pod was still terminating.
   */
  POD_DELETION: 60000,
  /** State store operation timeout (ms) */
  STATE_STORE: 5000
} as const;

/**
 * Grace period passed in the K8s DELETE body. Shorter than the K8s default
 * (30s) so termination is fast; the IDE container has no critical persistent
 * state to flush. waitForPodDeletion still honors POD_DELETION (60s) for
 * safety margin in slow clusters.
 */
const POD_DELETION_GRACE_SECONDS = 5;

/** OpenVSCode Server port (same as IDEService for Docker) */
const IDE_PORT = 3000;

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

  // Instance key creation uses createIDEKey from redisKeyUtils.ts
  // Format: org:user:project:feature (4 parts)

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
   *
   * Mount topology — keep aligned with [`k8sWorktreeMounts.ts`](./k8sWorktreeMounts.ts):
   * - Primary workspace mount uses the alias mountPath `/workspace` (mirrors
   *   Docker's `dockerWorkspacePath` alias). This guarantees absolute-path
   *   worktree mounts NEVER collide with the primary mount.
   * - Worktree-aware additional mounts (mainGitDir + worktreePath) come from
   *   `resolveK8sWorktreeMounts` and use absolute mountPaths so the worktree
   *   marker's `gitdir: <abs path>` back-reference resolves inside the pod.
   * - `workingDir: '/workspace'` makes openvscode-server open the alias as
   *   the default folder (1:1 with Docker's `WorkingDir: dockerWorkspacePath`).
   */
  private createPodSpec(
    instanceKey: string,
    resourceName: string,
    workspacePath: string,
    userContext: UserContext,
    feature: string,
  ): K8sPod {
    // Strict validation: any workspacePath outside ANT_WORKSPACE_BASE_PATH would
    // produce silent broken pods (subPath becomes a non-existent path inside the
    // PVC, the user sees an empty `/workspace`). Fail fast instead.
    this.assertWorkspacePathInBase(workspacePath);

    const primarySubPath = this.getSubPath(workspacePath);
    const worktreeMounts = resolveK8sWorktreeMounts(workspacePath, getWorkspaceBasePath());

    // Fail-fast: a non-base feature requires worktree mounts. If the helper
    // returned `[]`, the worktree marker is missing or invalid on EFS — most
    // likely the caller skipped `ensureGitRepository`. Surface the failure
    // to the user instead of producing a silent broken pod with an empty
    // `/mnt/workspaces/.../codebase/.git` path inside the container.
    if (feature !== RESERVED_FEATURE_NAME && worktreeMounts.length === 0) {
      throw new Error(
        `K8s IDE: feature pod '${feature}' requires worktree mounts but resolveK8sWorktreeMounts returned []. ` +
          `Likely cause: ensureGitRepository was not invoked before start(). ` +
          `Worktree path: ${workspacePath}. ` +
          `Check that the .git marker file exists and references a fully-formed gitdir.`
      );
    }

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
          'ant.example.com/instance-key': instanceKey,
          'ant.example.com/workspace-path': workspacePath
        }
      },
      spec: {
        containers: [{
          name: 'openvscode-server',
          image: this.options.image,
          // Default open folder for openvscode-server. Mirrors Docker's WorkingDir.
          workingDir: '/workspace',
          ports: [{ containerPort: 3000 }],  // openvscode-server uses port 3000
          // Command to start openvscode-server without authentication
          // ANT already has Google OIDC auth at the API layer, so IDE-level auth is unnecessary
          // --server-base-path: Required for proxy routing (all static assets use this base path)
          command: ['/home/.openvscode-server/bin/openvscode-server'],
          args: [
            '--host', '0.0.0.0',
            '--without-connection-token',
            '--server-base-path', `/ide/${instanceKey}`
          ],
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
          volumeMounts: [
            // Primary alias mount — keeps `/workspace` as the user-facing path.
            { name: 'workspace', mountPath: '/workspace', subPath: primarySubPath },
            // Absolute-path worktree mounts (empty for base / non-worktree).
            ...worktreeMounts,
          ],
          // K8s gates Service Endpoints on this probe — not-ready pods are
          // automatically excluded, so the proxy never forwards static-asset
          // requests to a still-booting openvscode-server. failureThreshold
          // gives ~60s grace for cold pulls / first-boot init.
          readinessProbe: {
            httpGet: { path: `/ide/${instanceKey}/`, port: 3000 },
            initialDelaySeconds: 1,
            periodSeconds: 1,
            timeoutSeconds: 2,
            failureThreshold: 60,
            successThreshold: 1,
          },
        }],
        volumes: [{
          name: 'workspace',
          persistentVolumeClaim: { claimName: getEfsPvcName() }
        }]
      }
    };
  }

  /**
   * Strict prefix check: workspacePath must live under ANT_WORKSPACE_BASE_PATH
   * so the PVC subPath can be derived. Misconfiguration (e.g. mismatched env
   * between API server and IDE pod) used to silently produce empty-folder pods;
   * surfacing the error here makes the failure mode obvious.
   */
  private assertWorkspacePathInBase(workspacePath: string): void {
    const base = getWorkspaceBasePath();
    if (!workspacePath.startsWith(base)) {
      throw new Error(
        `K8s IDE: workspacePath '${workspacePath}' is outside ANT_WORKSPACE_BASE_PATH '${base}'. ` +
        `EFS PVC subPath cannot be derived. Check ANT_WORKSPACE_BASE_PATH on both API server and IDE pod.`
      );
    }
  }

  /**
   * Convert full workspace path to EFS subPath.
   *
   * Throws (via `assertWorkspacePathInBase`) when the input is outside the
   * configured base — see Phase 1.3 of the K8s mount fix plan.
   *
   * e.g., /mnt/workspaces/to.nexus/probe/ant-ogf/codebase -> to.nexus/probe/ant-ogf/codebase (main)
   *        /mnt/workspaces/to.nexus/probe/ant-ogf/features/login/codebase -> to.nexus/probe/ant-ogf/features/login/codebase (feature)
   */
  private getSubPath(workspacePath: string): string {
    this.assertWorkspacePathInBase(workspacePath);
    // Remove leading slash on the relative remainder.
    return workspacePath.slice(getWorkspaceBasePath().length).replace(/^\/+/, '');
  }

  /**
   * Detect mount drift on an existing pod — does its volumeMount count
   * match what `resolveK8sWorktreeMounts` would produce now?
   *
   * Existed cases that produce drift:
   * - Pod created during a race when the worktree marker was missing →
   *   1 mount. Now worktree is valid → 3 mounts expected. Drift = true.
   * - Pod for the base branch (always 1 mount) accidentally surveyed
   *   against feature expectations. Drift = false (we compute expected
   *   from the same `feature` arg used to compute workspacePath).
   *
   * Returns `true` when a recreate is needed, `false` when reuse is safe.
   * Falls back to `false` (reuse) on inspection error so a transient k8s
   * API hiccup doesn't churn pods.
   */
  private hasMountDrift(existingPod: K8sPod, workspacePath: string, feature: string): boolean {
    try {
      const expectedExtraMounts = resolveK8sWorktreeMounts(workspacePath, getWorkspaceBasePath());
      const expectedCount = 1 + expectedExtraMounts.length; // alias mount + worktree mounts
      const container = existingPod.spec?.containers?.[0];
      const actualCount = container?.volumeMounts?.length ?? 0;
      if (expectedCount !== actualCount) {
        logger.warn(`Mount count mismatch on existing pod`, {
          component: 'KubernetesIDEOrchestrator',
        }, {
          feature,
          actualCount,
          expectedCount,
          workspacePath,
        });
        return true;
      }

      // Drift also covers spec features added in newer code that the existing
      // pod predates (pod spec is immutable). Without this, pods created
      // before the readinessProbe rollout would be reused indefinitely and
      // the IDE-readiness race would never be closed for those sessions.
      if (!container?.readinessProbe?.httpGet) {
        logger.warn(`Existing pod has no readinessProbe — recreating to apply HTTP-readiness gate`, {
          component: 'KubernetesIDEOrchestrator',
        }, { feature, workspacePath });
        return true;
      }

      return false;
    } catch (err: any) {
      // Inspection error (e.g. malformed pod spec) — keep existing pod, don't churn.
      logger.warn(`hasMountDrift inspection failed (treating as no drift)`, {
        component: 'KubernetesIDEOrchestrator',
      }, err);
      return false;
    }
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
    const { userContext, projectId, workspacePath, feature = RESERVED_FEATURE_NAME } = params;
    // Use centralized function for IDE instance key (org:user:project:feature)
    const instanceKey = createIDEKey(userContext.organizationId, userContext.userId, projectId, feature);
    const resourceName = this.createResourceName(instanceKey);
    const startTime = new Date().toISOString();

    // ✅ WARN level for production IDE debugging with timestamp
    logger.warn(`🚀 Starting K8s IDE: ${instanceKey} (${startTime})`, {
      component: 'KubernetesIDEOrchestrator',
      organizationId: userContext.organizationId,
      userId: userContext.userId,
      projectId
    }, { resourceName, namespace: this.options.namespace, workspacePath });

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
          // Pod is running — but first check for mount drift. If the worktree
          // was self-healed AFTER this pod was created (or the pod was created
          // during a race when the worktree marker was missing), the pod's
          // volumeMounts no longer match what `resolveK8sWorktreeMounts` would
          // produce now. Reusing such a pod leaves the user stuck on broken
          // mounts forever (pod spec is immutable). Detect drift and recreate.
          if (this.hasMountDrift(existingPod, workspacePath, feature)) {
            logger.warn(`Mount drift detected — recreating pod: ${resourceName}`, {
              component: 'KubernetesIDEOrchestrator',
            }, { resourceName });
            await this.deleteResources(resourceName);
            await this.waitForPodDeletion(resourceName);
            // fall through to fresh create
          } else {
            logger.info(`Pod already running, reusing: ${resourceName}`, { component: 'KubernetesIDEOrchestrator' });
            return this.createInstanceResult(existingPod, userContext.organizationId, userContext, projectId, feature, instanceKey);
          }
        } else {
          // Pod exists but not running (Failed, Pending, etc) - delete and recreate
          logger.info(`Pod not running (${existingPod.status?.phase}), recreating: ${resourceName}`, { component: 'KubernetesIDEOrchestrator' });
          await this.deleteResources(resourceName);
          await this.waitForPodDeletion(resourceName);
        }
      }

      // Create Pod
      logger.info(`Creating Pod: ${resourceName} in namespace ${this.options.namespace}`, { component: 'KubernetesIDEOrchestrator' });
      const podSpec = this.createPodSpec(instanceKey, resourceName, workspacePath, userContext, feature);
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

      // Safety net: even though K8s reports Ready (readinessProbe passed),
      // confirm via direct podIP HTTP probe before publishing the pod IP
      // to Redis. Same helper as Docker (waitForHttpReady) — single SSOT.
      const podIp = pod.status?.podIP;
      if (podIp) {
        try {
          await waitForHttpReady(podIp, IDE_PORT, `/ide/${instanceKey}/`, 30_000);
        } catch (probeErr: any) {
          logger.warn(`Pod readiness probe passed but direct HTTP probe failed: ${resourceName} — proceeding with registration`, {
            component: 'KubernetesIDEOrchestrator'
          }, probeErr);
        }
      }

      // Register in state store (IDE is feature-level)
      await this.stateStore.registerIDE(
        userContext.organizationId,
        userContext.userId,
        projectId,
        IDE_PORT,
        pod.status?.podIP || resourceName,
        resourceName,  // podId
        feature
      );

      const instance: IDEInstance = {
        instanceId: resourceName,
        host: pod.status?.podIP || resourceName,
        port: IDE_PORT,
        url: `/ide/${instanceKey}`,
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
    
    // ✅ WARN level for production visibility
    logger.warn(`⏳ Waiting for Pod: ${resourceName} (timeout: ${timeoutMs / 1000}s)`, {
      component: 'KubernetesIDEOrchestrator'
    });
    
    let lastPhase = '';
    let lastWaitReason = '';
    while (Date.now() - startTime < timeoutMs) {
      try {
        const pod = await this.k8sRequest<K8sPod>(
          `/api/v1/namespaces/${this.options.namespace}/pods/${resourceName}`
        );

        const phase = pod.status?.phase || 'Unknown';
        const containerStatuses = pod.status?.containerStatuses?.[0];
        const waiting = containerStatuses?.state?.waiting;
        const waitReason = waiting?.reason || '';
        const waitMessage = waiting?.message || '';
        
        // Check pod conditions for scheduling issues (important for Pending phase)
        const conditions = pod.status?.conditions || [];
        const podScheduled = conditions.find(c => c.type === 'PodScheduled');
        const schedulingIssue = podScheduled?.status === 'False' ? podScheduled.message : '';
        
        // Log when phase or wait reason changes, or every 30 seconds
        const elapsed = Date.now() - startTime;
        const shouldLog = phase !== lastPhase || waitReason !== lastWaitReason || elapsed % 30000 < 2000;
        
        if (shouldLog) {
          const waitInfo = waiting ? ` [${waitReason}: ${waitMessage}]` : '';
          const scheduleInfo = schedulingIssue ? ` [Scheduling: ${schedulingIssue}]` : '';
          logger.warn(`   Pod ${resourceName}: phase=${phase}${waitInfo}${scheduleInfo} (${Math.round(elapsed / 1000)}s elapsed)`, {
            component: 'KubernetesIDEOrchestrator'
          });
          lastPhase = phase;
          lastWaitReason = waitReason;
        }

        // Gate on `phase === 'Running' AND conditions[type=Ready].status === 'True'`.
        // The Ready condition flips to True only after the readinessProbe (HTTP GET
        // on /ide/<key>/ port 3000) succeeds — guaranteeing openvscode-server is
        // actually serving HTTP, not just that the container PID is alive.
        const readyCond = conditions.find(c => c.type === 'Ready');
        if (phase === 'Running' && readyCond?.status === 'True') {
          logger.warn(`✅ Pod is ready (HTTP responding): ${resourceName} (took ${Math.round(elapsed / 1000)}s)`, {
            component: 'KubernetesIDEOrchestrator'
          });
          return;
        }

        if (phase === 'Failed') {
          const reason = containerStatuses?.state?.terminated?.reason || 'Unknown';
          logger.error(`❌ Pod failed: ${resourceName}, reason=${reason}`, { 
            component: 'KubernetesIDEOrchestrator' 
          });
          throw new Error(`Pod failed to start: ${reason}`);
        }
      } catch (error: any) {
        if (!error.message.includes('404')) {
          logger.warn(`⚠️ Error checking pod ${resourceName}: ${error.message}`, { 
            component: 'KubernetesIDEOrchestrator' 
          });
          throw error;
        }
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Tail container logs so the operator can diagnose boot failures
    // (image pull, OOM, permission errors) instead of just seeing a timeout.
    let tailedLogs = '';
    try {
      tailedLogs = await this.tailContainerLogs(resourceName, 'openvscode-server', 100);
    } catch (logErr: any) {
      tailedLogs = `(failed to fetch container logs: ${logErr?.message || logErr})`;
    }
    logger.error(`❌ Pod startup timeout: ${resourceName} after ${timeoutMs}ms\n--- container logs (tail 100) ---\n${tailedLogs}\n--- end logs ---`, {
      component: 'KubernetesIDEOrchestrator'
    });
    throw new Error(`Pod ${resourceName} startup timeout after ${timeoutMs}ms`);
  }

  /**
   * Fetch the last N lines of a container's logs via the K8s API.
   * Used for diagnostic dumps on readiness timeout. The K8s log endpoint
   * returns plain text; `k8sRequest` falls back to raw text on JSON-parse
   * failure (see line 261-262), so we can request <T = string> directly.
   */
  private async tailContainerLogs(
    resourceName: string,
    container: string,
    lines: number = 100,
  ): Promise<string> {
    return this.k8sRequest<string>(
      `/api/v1/namespaces/${this.options.namespace}/pods/${resourceName}/log?container=${container}&tailLines=${lines}`,
      'GET'
    );
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
    // IDE is feature-level
    try {
      const registerPromise = this.stateStore.registerIDE(
        userContext.organizationId,
        userContext.userId,
        projectId,
        IDE_PORT,
        pod.status?.podIP || pod.metadata.name,
        pod.metadata.name,  // podId
        feature
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

    logger.info(`Instance result created: host=${instance.host}, port=${instance.port}`, {
      component: 'KubernetesIDEOrchestrator'
    });
    return {
      success: true,
      instance
    };
  }

  /**
   * Delete pod and service.
   *
   * The DELETE body sets `gracePeriodSeconds` so termination is fast (default
   * is 30s). `waitForPodDeletion` honors a longer 60s timeout for safety
   * margin in slow clusters — see TIMEOUTS.POD_DELETION rationale.
   */
  private async deleteResources(resourceName: string): Promise<void> {
    logger.info(`Deleting K8s resources: ${resourceName}`, {
      component: 'KubernetesIDEOrchestrator'
    });

    const gracePeriodBody = { gracePeriodSeconds: POD_DELETION_GRACE_SECONDS };

    try {
      await this.k8sRequest(
        `/api/v1/namespaces/${this.options.namespace}/pods/${resourceName}`,
        'DELETE',
        gracePeriodBody
      );
      logger.info(`Pod ${resourceName} delete request sent (grace=${POD_DELETION_GRACE_SECONDS}s)`, {
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
    feature: string = RESERVED_FEATURE_NAME
  ): Promise<{ success: boolean; message?: string }> {
    // tenantId is in format org:user, parse it
    const tenantParts = tenantId.split(':');
    const orgId = tenantParts[0] || '';
    const userId = tenantParts.length > 1 ? tenantParts[1] : '';
    
    // Use centralized function for IDE instance key (org:user:project:feature)
    const instanceKey = createIDEKey(orgId, userId, projectId, feature);
    const resourceName = this.createResourceName(instanceKey);

    logger.info(`Stopping K8s IDE: ${instanceKey}`, {
      component: 'KubernetesIDEOrchestrator'
    });

    try {
      await this.deleteResources(resourceName);
      // Block until the pod is fully gone so the caller (e.g. project deletion)
      // can safely run fs.rm without racing with EFS open file handles.
      // Tolerate timeout: log + proceed — the deletion is in progress, and
      // the caller's own fs.rm verification loop will catch leftovers.
      try {
        await this.waitForPodDeletion(resourceName);
      } catch (waitErr: any) {
        logger.warn(`Pod deletion wait timed out (continuing): ${waitErr.message} resource=${resourceName}`, {
          component: 'KubernetesIDEOrchestrator',
        });
      }

      await this.stateStore.unregisterIDE(orgId, userId, projectId, feature);

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
    feature: string = RESERVED_FEATURE_NAME
  ): Promise<IDEInstance | null> {
    // tenantId is in format org:user, parse it
    const tenantParts = tenantId.split(':');
    const orgId = tenantParts[0] || '';
    const userId = tenantParts.length > 1 ? tenantParts[1] : '';
    
    // Use centralized function for IDE instance key (org:user:project:feature)
    const instanceKey = createIDEKey(orgId, userId, projectId, feature);
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
        const instanceKey = pod.metadata.annotations?.['ant.example.com/instance-key'] || pod.metadata.name;
        
        // Use centralized parsing function for IDE instance key
        const parsed = parseIDEKey(instanceKey);
        if (!parsed) {
          logger.warn(`Invalid IDE instance key format: ${instanceKey}`, { component: 'KubernetesIDEOrchestrator' });
          // Fallback for malformed keys
          return {
            instanceId: pod.metadata.name,
            host: pod.status?.podIP || pod.metadata.name,
            port: IDE_PORT,
            url: `/ide/${instanceKey}`,
            workspacePath: pod.metadata.annotations?.['ant.example.com/workspace-path'] || '/workspace',
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
          url: `/ide/${instanceKey}`,
          workspacePath: pod.metadata.annotations?.['ant.example.com/workspace-path'] || '/workspace',
          status: (pod.status?.phase === 'Running' ? 'running' : 'starting') as IDEStatus,
          tenantId: parsed.tenantId,
          userId: parsed.userId,
          projectId: parsed.projectId,
          feature: parsed.feature || RESERVED_FEATURE_NAME
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
        const instanceKey = pod.metadata.annotations?.['ant.example.com/instance-key'] || pod.metadata.name;
        
        // Use centralized parsing function for IDE instance key
        const parsed = parseIDEKey(instanceKey);
        if (!parsed) {
          logger.warn(`Invalid IDE instance key format: ${instanceKey}`, { component: 'KubernetesIDEOrchestrator' });
          // Fallback - use userContext for userId
          return {
            instanceId: pod.metadata.name,
            host: pod.status?.podIP || pod.metadata.name,
            port: IDE_PORT,
            url: `/ide/${instanceKey}`,
            workspacePath: pod.metadata.annotations?.['ant.example.com/workspace-path'] || '/workspace',
            status: (pod.status?.phase === 'Running' ? 'running' : 'starting') as IDEStatus,
            tenantId: userContext.organizationId,
            userId: userContext.userId,
            projectId: instanceKey,
            feature: RESERVED_FEATURE_NAME
          };
        }

        return {
          instanceId: pod.metadata.name,
          host: pod.status?.podIP || pod.metadata.name,
          port: IDE_PORT,
          url: `/ide/${instanceKey}`,
          workspacePath: pod.metadata.annotations?.['ant.example.com/workspace-path'] || '/workspace',
          status: (pod.status?.phase === 'Running' ? 'running' : 'starting') as IDEStatus,
          tenantId: parsed.tenantId,
          userId: parsed.userId,
          projectId: parsed.projectId,
          feature: parsed.feature || RESERVED_FEATURE_NAME
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
      await this.stop(tenantId, projectId, instance.feature || RESERVED_FEATURE_NAME);
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
      // Skip instances with invalid key components (from malformed annotations)
      if (!instance.tenantId || !instance.userId || !instance.projectId) {
        logger.warn(`Skipping idle check for instance with invalid key: tenantId=${instance.tenantId}, userId=${instance.userId}, projectId=${instance.projectId}`, {
          component: 'KubernetesIDEOrchestrator'
        });
        continue;
      }
      
      // Check last access time from state store (IDE is feature-level)
      const portMapping = await this.stateStore.getIDE(
        instance.tenantId,
        instance.userId,
        instance.projectId,
        instance.feature || RESERVED_FEATURE_NAME
      );

      if (portMapping) {
        const lastAccess = portMapping.lastAccessedAt?.getTime() || 0;
        const idleTime = now - lastAccess;

        if (idleTime > this.options.idleTimeoutMs) {
          logger.info(`Terminating idle K8s IDE: ${instance.instanceId}`, {
            component: 'KubernetesIDEOrchestrator'
          });

          // stop() expects tenantId in "org:user" format
          await this.stop(
            `${instance.tenantId}:${instance.userId}`,
            instance.projectId,
            instance.feature || RESERVED_FEATURE_NAME
          );
        }
      }
    }
  }
}
