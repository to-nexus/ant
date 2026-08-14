/**
 * SSEManager - Unified SSE Connection Manager
 * 
 * Responsibilities:
 * - 단일 EventSource 인스턴스 생성/관리
 * - 메시지 타입별 라우팅
 * - 연결 상태 모니터링
 * - 자동 재연결
 * - Store에 데이터 전달
 * 
 * Architecture:
 * - React와 완전 독립
 * - 애플리케이션 생명주기 동안 단 1개 인스턴스 (Singleton)
 * - ID 기반 핸들러 등록/해제로 누수 방지
 * 
 * Usage:
 *   // Register handlers with ID for reliable cleanup
 *   const id = sseManager.registerHandlerWithId('kanban', (data) => {
 *     useStore.getState().updateKanban(data);
 *   });
 *   // Unregister by ID
 *   sseManager.unregisterHandlerById(id);
 *   
 *   // Connect to unified SSE endpoint
 *   sseManager.connect(projectId, featureName);
 * 
 * @see packages/ant-ui/ARCHITECTURE.md
 */

import { REALTIME_BASE, API_BASE } from '../http/api';
import { featureNameToSlug } from '@ant/shared';
import { fetchAuthMeDetailed } from '@ant/auth-client';
import {
  getAuthBroadcaster,
  isSessionExpired,
  markSessionExpired,
} from '../auth/authBridge';
import type { SSEMessageType } from '@ant/shared';

// Canonical union is defined in @ant/shared/sse-events and re-exported here
// so existing consumers (useFileTree, useChat, ...) don't break.
export type { SSEMessageType };
export type SSEMessageHandler = (data: any) => void;

// ✅ 핸들러 식별을 위한 고유 ID (중복 등록 방지 및 정확한 해제)
let handlerIdCounter = 0;
export type HandlerId = number;

interface SSEMessage {
  type: SSEMessageType;
  timestamp: string;
  data: any;
}

interface SSEConnection {
  eventSource: EventSource;
  url: string;
  projectId: string;
  featureName: string;
  isConnected: boolean;
  reconnectAttempts: number;
  /** `performance.now()` of the last `onopen` — see MIN_HEALTHY_CONNECTION_MS. */
  openedAt?: number;
  /** True once this connection has opened at least once (reconnect detection). */
  hasOpenedBefore?: boolean;
}

interface WorkflowConnection {
  eventSource: EventSource;
  url: string;
  jobId: string;
  isConnected: boolean;
  reconnectAttempts: number;
  /** `performance.now()` of the last `onopen` — see MIN_HEALTHY_CONNECTION_MS. */
  openedAt?: number;
}

export type ConnectionStatus = 'connected' | 'disconnected' | 'error';
export type ConnectionStatusCallback = (status: ConnectionStatus) => void;

class SSEManager {
  // Single unified SSE connection per project/feature
  private unifiedConnection: SSEConnection | null = null;

  // Workflow SSE connections (per job)
  private workflowConnections: Map<string, WorkflowConnection> = new Map();

  // Message handlers by type
  private handlers: Map<SSEMessageType, SSEMessageHandler[]> = new Map();

  // ✅ 핸들러 ID 기반 관리 (중복 방지 및 정확한 해제)
  private handlerRegistry: Map<HandlerId, { type: SSEMessageType; handler: SSEMessageHandler }> = new Map();

  private maxReconnectAttempts = 5;

  /**
   * How long a connection must survive before its `onopen` counts as recovery.
   *
   * `onopen` used to reset `reconnectAttempts` unconditionally, so a stream that
   * opened with a valid 200 and then closed immediately never reached
   * `maxReconnectAttempts`: no `statusCallback('error')`, no `/auth/me` probe,
   * no server-down modal — the browser just reconnected every 3 s forever while
   * the UI looked idle. A server-side outage produced exactly that shape (200
   * headers committed, then the stream ended), so an open that dies this fast is
   * counted as a failed attempt, not as a recovery.
   */
  private static readonly MIN_HEALTHY_CONNECTION_MS = 5000;

  /**
   * Retry budget carried across a self-scheduled reconnect.
   *
   * `disconnect()` drops the connection object, so a reconnect we schedule
   * ourselves would otherwise restart `reconnectAttempts` at 0 and never reach
   * `maxReconnectAttempts` — the escalation (error status, auth probe, modal)
   * could never fire, and the backoff would never grow. Keyed by target so a
   * genuine navigation starts with a fresh budget.
   */
  private carriedRetry: { key: string; attempts: number } | null = null;

  private static retryKey(projectId: string, featureName: string, job: string): string {
    return `${projectId}|${featureName}|${job}`;
  }

  // Connection status callback - notifies Store when SSE connection status changes
  private statusCallback: ConnectionStatusCallback | null = null;

  // Early error callback -- fires on the FIRST SSE error without changing
  // connectionStatus.  ServerDownDetector uses this to trigger a health check
  // before the 5-attempt retry cycle completes.
  private onErrorCallback: (() => void) | null = null;

  // Reconnect callback -- fires when unified SSE reconnects (not on initial connect).
  // Used by Store to enable grace period that protects isRunning from stale initial data.
  private onReconnectCallback: (() => void) | null = null;

  // Visibility change handler for multi-tab sync
  private visibilityHandler: (() => void) | null = null;
  private lastForceReconnectTime = 0;

  // Cross-tab session-expired bridge — when another tab signals expiry,
  // disconnect and suppress reconnects until the next successful login
  // (which clears the flag via `clearSessionExpired`). Subscribed once at
  // first connect.
  private broadcastUnsubscribe: (() => void) | null = null;
  
  /**
   * Register a callback to be notified when unified SSE connection status changes.
   * Called from Store's initializeSSE() so connectionStatus reflects actual EventSource state.
   */
  setStatusCallback(callback: ConnectionStatusCallback): void {
    this.statusCallback = callback;
  }

  /**
   * Register a callback that fires on the first SSE error of each disconnect cycle.
   * Does NOT change connectionStatus -- the conservative retry logic is untouched.
   */
  setOnErrorCallback(callback: (() => void) | null): void {
    this.onErrorCallback = callback;
  }

  /**
   * Register a callback that fires when the unified SSE reconnects (not on initial connect).
   * Store uses this to enable a grace period protecting isRunning from stale initial data.
   */
  setOnReconnectCallback(callback: (() => void) | null): void {
    this.onReconnectCallback = callback;
  }
  
  /**
   * Register handler with ID - enables reliable cleanup
   * Returns a HandlerId that must be used for unregistration
   */
  registerHandlerWithId(type: SSEMessageType, handler: SSEMessageHandler): HandlerId {
    const id = ++handlerIdCounter;
    
    if (!this.handlers.has(type)) {
      this.handlers.set(type, []);
    }
    this.handlers.get(type)!.push(handler);
    this.handlerRegistry.set(id, { type, handler });
    
    return id;
  }
  
  /**
   * ✅ Unregister handler by ID - guaranteed correct removal
   */
  unregisterHandlerById(id: HandlerId): void {
    const entry = this.handlerRegistry.get(id);
    if (!entry) return;
    
    const handlers = this.handlers.get(entry.type);
    if (handlers) {
      const index = handlers.indexOf(entry.handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
    this.handlerRegistry.delete(id);
  }
  
  /**
   * Connect to unified SSE endpoint
   */
  connect(projectId: string, featureName: string, job: string = 'code'): void {
    // Hard suppress: a session-expired event was observed (locally or from
    // another tab). Don't open new connections — the next successful login
    // clears the flag and `setUser`'s lifecycle will trigger reconnects.
    if (isSessionExpired()) {
      console.log('[SSE] unified: connect suppressed (session-expired flag set)');
      return;
    }

    this.ensureBroadcastSubscribed();

    // Close existing connection if different project/feature/job
    if (this.unifiedConnection) {
      const currentJob = new URL(this.unifiedConnection.url).searchParams.get('job');
      
      if (this.unifiedConnection.projectId === projectId && 
          this.unifiedConnection.featureName === featureName &&
          currentJob === job) {
        return;
      }
      
      this.disconnect();
    }
    
    // Build SSE URL — authentication is handled via httpOnly JWT cookie
    // (withCredentials: true sends the cookie automatically)
    const realtimeBase = REALTIME_BASE();
    // Feature name may contain `/`; slug it to a single path segment (the
    // realtime server's router.param decodes it back).
    const basePath = `${realtimeBase}/projects/${projectId}/features/${featureNameToSlug(featureName)}/stream`;
    const url = realtimeBase.startsWith('http') ? new URL(basePath) : new URL(basePath, window.location.origin);
    url.searchParams.set('job', job);
    
    const finalUrl = url.toString();
    console.log(`[SSE] unified: connecting ${projectId}/${featureName}`);
    
    try {
      const eventSource = new EventSource(finalUrl, {
        withCredentials: true  // ✅ Send cookies for authentication
      });
      
      eventSource.onopen = () => {
        // Reconnect detection tracks "has this connection opened before", not the
        // retry counter — the counter is now cleared by a surviving connection in
        // onerror, so it no longer means "this is a reopen".
        const wasReconnect = this.unifiedConnection?.hasOpenedBefore === true;
        if (this.unifiedConnection) {
          this.unifiedConnection.isConnected = true;
          this.unifiedConnection.openedAt = performance.now();
          this.unifiedConnection.hasOpenedBefore = true;
          // reconnectAttempts is NOT reset here — a connection has to survive
          // MIN_HEALTHY_CONNECTION_MS before it counts as recovery (see onerror).
        }
        console.log(`[SSE] unified: open${wasReconnect ? ' (reconnect)' : ''}`);
        this.statusCallback?.('connected');
        if (wasReconnect) {
          this.onReconnectCallback?.();
        }
      };
      
      eventSource.onmessage = (event) => {
        try {
          const message: SSEMessage = JSON.parse(event.data);
          this.routeMessage(message);
        } catch (error) {
          console.error('[SSE] unified: parse error', error);
        }
      };
      
      eventSource.onerror = () => {
        // NOTE: Do NOT call statusCallback('error') on every onerror.
        // EventSource fires onerror on transient network issues and the browser
        // auto-reconnects. Setting 'error' would cause connectionStatus flickering
        // which breaks useFileTree, useChat, useUIActionPolicy, etc.
        // Only report 'error' when all reconnection attempts are exhausted.
        if (this.unifiedConnection) {
          const openedAt = this.unifiedConnection.openedAt;
          const survived =
            openedAt !== undefined &&
            performance.now() - openedAt >= SSEManager.MIN_HEALTHY_CONNECTION_MS;
          // A connection that lived long enough proves the transport works, so
          // this error starts a fresh retry budget. One that died on arrival
          // keeps the budget, so the cycle escalates instead of looping silently.
          if (survived) this.unifiedConnection.reconnectAttempts = 0;

          this.unifiedConnection.isConnected = false;
          this.unifiedConnection.openedAt = undefined;
          this.unifiedConnection.reconnectAttempts++;
          console.warn(`[SSE] unified: error (attempt ${this.unifiedConnection.reconnectAttempts}/${this.maxReconnectAttempts})`);

          // Notify early error listener on the first failure so it can run
          // a health check immediately (without waiting for 5 retries).
          if (this.unifiedConnection.reconnectAttempts === 1) {
            this.onErrorCallback?.();
          }
          
          // The browser only auto-reconnects after a transport-level failure. On
          // a non-200 (503 when the server refuses, 401 after session loss) it
          // sets readyState=CLOSED and never retries — so if we don't schedule
          // the retry ourselves, one transient refusal leaves the app silently
          // disconnected until a tab switch or a project change.
          const browserGaveUp = eventSource.readyState === EventSource.CLOSED;
          const exhausted = this.unifiedConnection.reconnectAttempts >= this.maxReconnectAttempts;

          if (exhausted || browserGaveUp) {
            const retryDelay = exhausted
              ? Math.min(30000, 1000 * Math.pow(2, this.unifiedConnection.reconnectAttempts - this.maxReconnectAttempts))
              : Math.min(30000, 1000 * Math.pow(2, this.unifiedConnection.reconnectAttempts - 1));
            const savedProjectId = this.unifiedConnection.projectId;
            const savedFeatureName = this.unifiedConnection.featureName;
            const savedUrl = new URL(this.unifiedConnection.url);
            const savedJob = savedUrl.searchParams.get('job') || 'code';

            // Report error only when giving up on auto-reconnect
            if (exhausted) this.statusCallback?.('error');
            this.carriedRetry = {
              key: SSEManager.retryKey(savedProjectId, savedFeatureName, savedJob),
              attempts: this.unifiedConnection.reconnectAttempts,
            };
            this.disconnect();

            // Probe /auth/me before scheduling another reconnect cycle.
            // EventSource onerror gives no status code, so a 401 is invisible
            // to us — without this probe we'd reconnect-storm forever after
            // JWT expiry mid-session. If the session is gone, fire the same
            // session-expired cascade as the HTTP 401 interceptor and STOP.
            console.log(`[SSE] unified: reconnecting in ${retryDelay}ms (probing auth first)`);
            setTimeout(() => {
              this.runAuthProbeAndMaybeReconnect(savedProjectId, savedFeatureName, savedJob);
            }, retryDelay);
          }
        }
      };
      
      // Inherit the budget only when this is a retry of the same target.
      const retryKey = SSEManager.retryKey(projectId, featureName, job);
      const carriedAttempts = this.carriedRetry?.key === retryKey ? this.carriedRetry.attempts : 0;
      this.carriedRetry = null;

      this.unifiedConnection = {
        eventSource,
        url: finalUrl,
        projectId,
        featureName,
        isConnected: false,
        reconnectAttempts: carriedAttempts
      };

      this.setupVisibilityHandler();
      
    } catch (error) {
      console.error('[SSE] unified: failed to create EventSource', error);
    }
  }
  
  /**
   * Update the job query parameter on the stored URL without reconnecting.
   * Ensures forceReconnect (tab visibility) and onerror recovery use the correct job type.
   */
  updateJobParam(job: string): void {
    if (!this.unifiedConnection) return;
    const url = new URL(this.unifiedConnection.url);
    url.searchParams.set('job', job);
    this.unifiedConnection.url = url.toString();
  }

  /**
   * Force-reconnect unified SSE without triggering statusCallback('disconnected').
   * Used by visibility change handler to sync state when tab becomes active.
   * Debounced to 3 seconds to prevent rapid tab-switching floods.
   */
  forceReconnect(): void {
    if (!this.unifiedConnection) return;

    const now = Date.now();
    if (now - this.lastForceReconnectTime < 3000) return;
    this.lastForceReconnectTime = now;

    const { projectId, featureName, url } = this.unifiedConnection;
    const job = new URL(url).searchParams.get('job') || 'code';

    console.log(`[SSE] forceReconnect: ${projectId}/${featureName}`);

    // Notify reconnect BEFORE disconnect so grace period is active when new initial data arrives
    this.onReconnectCallback?.();

    // Nullify reference BEFORE closing so any late onerror is a no-op
    const oldES = this.unifiedConnection.eventSource;
    this.unifiedConnection = null;
    try { oldES.close(); } catch {}

    // New connect() will proceed since unifiedConnection is now null
    this.connect(projectId, featureName, job);
  }

  /**
   * Probe /auth/me after exhausted reconnect attempts. EventSource onerror
   * gives no HTTP status, so a 401 (cookie expired mid-session) is
   * indistinguishable from a transient network blip. Without this probe the
   * exponential-backoff loop would retry forever after JWT expiry.
   *
   *   /auth/me kind='no-session' → fire session-expired cascade, STOP
   *   anything else              → schedule normal reconnect
   */
  private async runAuthProbeAndMaybeReconnect(
    projectId: string,
    featureName: string,
    job: string,
  ): Promise<void> {
    if (isSessionExpired()) {
      console.log('[SSE] unified: skipping reconnect (session-expired)');
      return;
    }
    try {
      const result = await fetchAuthMeDetailed({ apiBase: API_BASE() });
      if (result.kind === 'no-session') {
        console.warn('[SSE] unified: auth probe says no-session — entering session-expired state');
        markSessionExpired();
        try {
          getAuthBroadcaster().post({ type: 'session-expired', at: Date.now() });
        } catch (err) {
          console.error('[SSE] broadcast session-expired failed', err);
        }
        const { useStore } = await import('@/domain/store');
        const state = useStore.getState() as any;
        if (typeof state.clearUser === 'function') state.clearUser();
        return;
      }
    } catch (err) {
      // Probe itself failed (network down) — treat as transient and reconnect.
      console.warn('[SSE] unified: auth probe failed; assuming transient', err);
    }

    // Enable grace period before reconnecting so that stale initial
    // data (estimating/session) doesn't overwrite the kanban state.
    this.onReconnectCallback?.();
    this.connect(projectId, featureName, job);
  }

  /**
   * Subscribe (once) to the cross-tab auth broadcaster so a `session-expired`
   * from another tab tears down our connection here too. Idempotent.
   */
  private ensureBroadcastSubscribed(): void {
    if (this.broadcastUnsubscribe) return;
    const broadcaster = getAuthBroadcaster();
    this.broadcastUnsubscribe = broadcaster.subscribe((message) => {
      if (message.type === 'session-expired' || message.type === 'logout') {
        if (message.type === 'session-expired') markSessionExpired();
        if (this.unifiedConnection) {
          console.log(`[SSE] unified: closing on cross-tab ${message.type}`);
          this.disconnect();
        }
        this.workflowConnections.forEach((_, jobId) => this.disconnectWorkflow(jobId));
      }
    });
  }

  /**
   * Register visibility change listener (once) so that when the browser tab
   * becomes visible, we force-reconnect to get fresh initial state from the server.
   * This fixes multi-tab desync caused by background tab throttling/freezing.
   */
  private setupVisibilityHandler(): void {
    if (this.visibilityHandler) return;

    this.visibilityHandler = () => {
      if (document.visibilityState === 'visible') {
        this.forceReconnect();
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  /**
   * Connect to workflow SSE endpoint (per job)
   */
  connectWorkflow(jobId: string): void {
    if (this.workflowConnections.has(jobId)) {
      return;
    }
    
    // Build workflow SSE URL — authentication is handled via httpOnly JWT cookie
    const realtimeBase = REALTIME_BASE();
    const basePath = `${realtimeBase}/jobs/${jobId}/workflow/stream`;
    const url = realtimeBase.startsWith('http') ? new URL(basePath) : new URL(basePath, window.location.origin);
    
    const finalUrl = url.toString();
    console.log(`[SSE] workflow(${jobId}): connecting`);
    
    try {
      const eventSource = new EventSource(finalUrl, {
        withCredentials: true
      });
      
      eventSource.onopen = () => {
        const conn = this.workflowConnections.get(jobId);
        if (conn) {
          conn.isConnected = true;
          conn.openedAt = performance.now();
          // Same rule as the unified stream: recovery is proven by surviving,
          // not by opening (see MIN_HEALTHY_CONNECTION_MS).
        }
        console.log(`[SSE] workflow(${jobId}): open`);
      };
      
      eventSource.onmessage = (event) => {
        try {
          const message: SSEMessage = JSON.parse(event.data);
          this.routeMessage(message);
        } catch (error) {
          console.error(`[SSE] workflow(${jobId}): parse error`, error);
        }
      };
      
      // ✅ Handle 'end' event for workflow completion
      eventSource.addEventListener('end', () => {
        this.routeMessage({
          type: 'workflow',
          timestamp: new Date().toISOString(),
          data: {
            jobId,
            eventType: 'end',
            isCompleted: true
          }
        });
      });
      
      eventSource.onerror = () => {
        const conn = this.workflowConnections.get(jobId);
        if (conn) {
          const survived =
            conn.openedAt !== undefined &&
            performance.now() - conn.openedAt >= SSEManager.MIN_HEALTHY_CONNECTION_MS;
          if (survived) conn.reconnectAttempts = 0;

          conn.isConnected = false;
          conn.openedAt = undefined;
          conn.reconnectAttempts++;
          console.warn(`[SSE] workflow(${jobId}): error (attempt ${conn.reconnectAttempts}/${this.maxReconnectAttempts})`);
          
          // Same rule as the unified stream: on a non-200 the browser sets
          // readyState=CLOSED and never retries, so we must schedule it.
          const browserGaveUp = eventSource.readyState === EventSource.CLOSED;
          const exhausted = conn.reconnectAttempts >= this.maxReconnectAttempts;

          if (exhausted || browserGaveUp) {
            const retryDelay = exhausted
              ? Math.min(30000, 1000 * Math.pow(2, conn.reconnectAttempts - this.maxReconnectAttempts))
              : Math.min(30000, 1000 * Math.pow(2, conn.reconnectAttempts - 1));
            const carriedAttempts = conn.reconnectAttempts;

            this.disconnectWorkflow(jobId);

            console.log(`[SSE] workflow(${jobId}): reconnecting in ${retryDelay}ms`);
            setTimeout(() => {
              this.connectWorkflow(jobId);
              // Carry the budget across our own reconnect so repeated refusals
              // still escalate instead of restarting at 0 forever.
              const next = this.workflowConnections.get(jobId);
              if (next) next.reconnectAttempts = carriedAttempts;
            }, retryDelay);
          }
          // Otherwise the failure was transport-level and the browser auto-reconnects.
        }
      };
      
      this.workflowConnections.set(jobId, {
        eventSource,
        url: finalUrl,
        jobId,
        isConnected: false,
        reconnectAttempts: 0
      });
      
    } catch (error) {
      console.error(`[SSE] workflow(${jobId}): failed to create EventSource`, error);
    }
  }
  
  /**
   * Route message to registered handlers based on type
   */
  private routeMessage(message: SSEMessage): void {
    const { type, data } = message;
    
    const handlers = this.handlers.get(type);
    
    if (!handlers || handlers.length === 0) {
      return;
    }
    
    handlers.forEach(handler => {
      try {
        handler(data);
      } catch (error) {
        console.error(`[SSE] handler error for '${type}':`, error);
      }
    });
  }
  
  /**
   * Disconnect unified SSE
   */
  disconnect(): void {
    if (this.unifiedConnection) {
      console.log('[SSE] unified: closed');
      try {
        this.unifiedConnection.eventSource.close();
      } catch (error) {
        // Ignore errors on close
      }
      this.unifiedConnection = null;
      this.statusCallback?.('disconnected');
    }
  }
  
  /**
   * Disconnect workflow SSE
   */
  disconnectWorkflow(jobId: string): void {
    const conn = this.workflowConnections.get(jobId);
    if (conn) {
      console.log(`[SSE] workflow(${jobId}): closed`);
      try {
        conn.eventSource.close();
      } catch (error) {
        // Ignore errors on close
      }
      this.workflowConnections.delete(jobId);
    }
  }
  
  /**
   * Disconnect all SSE connections (unified + workflow) without clearing handlers/callbacks.
   * Used during project switch to tear down connections before new ones are established.
   */
  disconnectAll(): void {
    this.disconnect();
    this.workflowConnections.forEach((_, jobId) => {
      this.disconnectWorkflow(jobId);
    });
  }
  
  /**
   * Get connection status
   */
  isConnected(): boolean {
    return this.unifiedConnection?.isConnected || false;
  }
  
  /**
   * Get workflow connection status
   */
  isWorkflowConnected(jobId: string): boolean {
    return this.workflowConnections.get(jobId)?.isConnected || false;
  }
}

// Export singleton instance
export const sseManager = new SSEManager();

// Debug access (개발 환경에서만)
if (import.meta.env.DEV) {
  (window as any).__sseManager = sseManager;
  console.log('[SSE] debug: sseManager available at window.__sseManager');
}
