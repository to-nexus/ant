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
 * - 메모리 누수 방지를 위한 cleanup 보장
 * 
 * Usage:
 *   // Register handlers for different message types
 *   sseManager.registerHandler('kanban', (data) => {
 *     useStore.getState().updateKanban(data);
 *   });
 *   
 *   // Connect to unified SSE endpoint
 *   sseManager.connect(projectId, featureName);
 * 
 * @see packages/ant-ui/ARCHITECTURE.md
 */

import { REALTIME_BASE } from '../http/api';

// ✅ NOTE: backend unified SSE stream also emits 'preview' events
export type SSEMessageType = 'kanban' | 'chat' | 'fileTree' | 'workflow' | 'preview' | 'gitChange' | 'transfer' | 'unseenArtifacts';
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
}

interface WorkflowConnection {
  eventSource: EventSource;
  url: string;
  jobId: string;
  isConnected: boolean;
  reconnectAttempts: number;
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
  
  // Connection status callback - notifies Store when SSE connection status changes
  private statusCallback: ConnectionStatusCallback | null = null;

  // Early error callback -- fires on the FIRST SSE error without changing
  // connectionStatus.  ServerDownDetector uses this to trigger a health check
  // before the 5-attempt retry cycle completes.
  private onErrorCallback: (() => void) | null = null;

  // Visibility change handler for multi-tab sync
  private visibilityHandler: (() => void) | null = null;
  private lastForceReconnectTime = 0;
  
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
   * Register message handler for a specific type
   * Prefer registerHandlerWithId for better cleanup support.
   */
  registerHandler(type: SSEMessageType, handler: SSEMessageHandler): void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, []);
    }
    this.handlers.get(type)!.push(handler);
  }
  
  /**
   * ✅ Register handler with ID - enables reliable cleanup
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
   * Clear all handlers for a specific type (or all types)
   */
  clearHandlers(type?: SSEMessageType): void {
    if (type) {
      this.handlers.delete(type);
    } else {
      this.handlers.clear();
    }
  }
  
  /**
   * Unregister message handler
   */
  unregisterHandler(type: SSEMessageType, handler: SSEMessageHandler): void {
    const handlers = this.handlers.get(type);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }
  
  /**
   * Connect to unified SSE endpoint
   */
  connect(projectId: string, featureName: string, job: string = 'code'): void {
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
    
    // ✅ Get user email from localStorage for authentication
    let userEmail: string | undefined;
    try {
      const stored = localStorage.getItem('ant-ui:user-email');
      if (stored) {
        userEmail = JSON.parse(stored);
      }
    } catch (error) {
      console.warn('[SSE] unified: failed to get user email', error);
    }
    
    // ✅ Build URL with user email as query parameter (for EventSource authentication)
    // Uses dedicated Realtime Server for SSE (see 10-cloud-architecture.md)
    // 사용자 설정(localStorage)에 따라 적절한 백엔드 URL 사용
    const realtimeBase = REALTIME_BASE();
    const basePath = `${realtimeBase}/projects/${projectId}/features/${featureName}/stream`;
    const url = realtimeBase.startsWith('http') ? new URL(basePath) : new URL(basePath, window.location.origin);
    url.searchParams.set('job', job);
    if (userEmail) {
      url.searchParams.set('user-email', userEmail);
    }
    
    const finalUrl = url.toString();
    console.log(`[SSE] unified: connecting ${projectId}/${featureName}`);
    
    try {
      const eventSource = new EventSource(finalUrl, {
        withCredentials: true  // ✅ Send cookies for authentication
      });
      
      eventSource.onopen = () => {
        if (this.unifiedConnection) {
          this.unifiedConnection.isConnected = true;
          this.unifiedConnection.reconnectAttempts = 0;
        }
        console.log('[SSE] unified: open');
        // Notify Store that SSE is actually connected (not optimistic)
        this.statusCallback?.('connected');
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
          this.unifiedConnection.isConnected = false;
          this.unifiedConnection.reconnectAttempts++;
          console.warn(`[SSE] unified: error (attempt ${this.unifiedConnection.reconnectAttempts}/${this.maxReconnectAttempts})`);

          // Notify early error listener on the first failure so it can run
          // a health check immediately (without waiting for 5 retries).
          if (this.unifiedConnection.reconnectAttempts === 1) {
            this.onErrorCallback?.();
          }
          
          if (this.unifiedConnection.reconnectAttempts >= this.maxReconnectAttempts) {
            // Exponential backoff retry after max attempts
            const retryDelay = Math.min(30000, 1000 * Math.pow(2, this.unifiedConnection.reconnectAttempts - this.maxReconnectAttempts));
            const savedProjectId = this.unifiedConnection.projectId;
            const savedFeatureName = this.unifiedConnection.featureName;
            const savedUrl = new URL(this.unifiedConnection.url);
            const savedJob = savedUrl.searchParams.get('job') || 'code';
            
            // Report error only when giving up on auto-reconnect
            this.statusCallback?.('error');
            this.disconnect();
            
            console.log(`[SSE] unified: reconnecting in ${retryDelay}ms`);
            setTimeout(() => {
              this.connect(savedProjectId, savedFeatureName, savedJob);
            }, retryDelay);
          }
        }
      };
      
      this.unifiedConnection = {
        eventSource,
        url: finalUrl,
        projectId,
        featureName,
        isConnected: false,
        reconnectAttempts: 0
      };

      this.setupVisibilityHandler();
      
    } catch (error) {
      console.error('[SSE] unified: failed to create EventSource', error);
    }
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

    // Nullify reference BEFORE closing so any late onerror is a no-op
    const oldES = this.unifiedConnection.eventSource;
    this.unifiedConnection = null;
    try { oldES.close(); } catch {}

    // New connect() will proceed since unifiedConnection is now null
    this.connect(projectId, featureName, job);
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
    
    // ✅ Get user email from localStorage for authentication
    let userEmail: string | undefined;
    try {
      const stored = localStorage.getItem('ant-ui:user-email');
      if (stored) {
        userEmail = JSON.parse(stored);
      }
    } catch (error) {
      console.warn('[SSE] workflow: failed to get user email', error);
    }
    
    // ✅ Build URL with user email as query parameter
    // Uses dedicated Realtime Server for SSE (see 10-cloud-architecture.md)
    // 사용자 설정(localStorage)에 따라 적절한 백엔드 URL 사용
    const realtimeBase = REALTIME_BASE();
    const basePath = `${realtimeBase}/jobs/${jobId}/workflow/stream`;
    const url = realtimeBase.startsWith('http') ? new URL(basePath) : new URL(basePath, window.location.origin);
    if (userEmail) {
      url.searchParams.set('user-email', userEmail);
    }
    
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
          conn.reconnectAttempts = 0;
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
          conn.isConnected = false;
          conn.reconnectAttempts++;
          console.warn(`[SSE] workflow(${jobId}): error (attempt ${conn.reconnectAttempts}/${this.maxReconnectAttempts})`);
          
          if (conn.reconnectAttempts >= this.maxReconnectAttempts) {
            // Exponential backoff retry after max attempts
            const retryDelay = Math.min(30000, 1000 * Math.pow(2, conn.reconnectAttempts - this.maxReconnectAttempts));
            
            this.disconnectWorkflow(jobId);
            
            console.log(`[SSE] workflow(${jobId}): reconnecting in ${retryDelay}ms`);
            setTimeout(() => {
              this.connectWorkflow(jobId);
            }, retryDelay);
          }
          // If under maxReconnectAttempts, EventSource auto-reconnects (browser default)
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
   * Cleanup all connections
   */
  cleanup(): void {
    this.disconnect();
    
    this.workflowConnections.forEach((_, jobId) => {
      this.disconnectWorkflow(jobId);
    });
    
    this.handlers.clear();
    this.statusCallback = null;

    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
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
