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

import { getApiBase } from '../http/api';

export type SSEMessageType = 'kanban' | 'chat' | 'fileTree' | 'workflow';
export type SSEMessageHandler = (data: any) => void;

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
}

class SSEManager {
  // Single unified SSE connection per project/feature
  private unifiedConnection: SSEConnection | null = null;
  
  // Workflow SSE connections (per job)
  private workflowConnections: Map<string, WorkflowConnection> = new Map();
  
  // Message handlers by type
  private handlers: Map<SSEMessageType, SSEMessageHandler[]> = new Map();
  
  private maxReconnectAttempts = 5;
  
  /**
   * Register message handler for a specific type
   */
  registerHandler(type: SSEMessageType, handler: SSEMessageHandler): void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, []);
    }
    this.handlers.get(type)!.push(handler);
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
  connect(projectId: string, featureName: string, job: 'design' | 'code' | 'learn' = 'code'): void {
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
      console.warn('[SSEManager] Failed to get user email:', error);
    }
    
    // ✅ Build URL with user email as query parameter (for EventSource authentication)
    const url = new URL(`${getApiBase()}/projects/${projectId}/features/${featureName}/stream`);
    url.searchParams.set('job', job);
    if (userEmail) {
      url.searchParams.set('user-email', userEmail);
    }
    
    const finalUrl = url.toString();
    
    try {
      const eventSource = new EventSource(finalUrl, {
        withCredentials: true  // ✅ Send cookies for authentication
      });
      
      eventSource.onopen = () => {
        if (this.unifiedConnection) {
          this.unifiedConnection.isConnected = true;
          this.unifiedConnection.reconnectAttempts = 0;
        }
      };
      
      eventSource.onmessage = (event) => {
        try {
          const message: SSEMessage = JSON.parse(event.data);
          this.routeMessage(message);
        } catch (error) {
          console.error(`[SSEManager] Parse error:`, error);
          console.error('[SSEManager] Raw data:', event.data);
        }
      };
      
      eventSource.onerror = (error) => {
        console.error(`[SSEManager] Connection error:`, error);
        if (this.unifiedConnection) {
          this.unifiedConnection.isConnected = false;
          this.unifiedConnection.reconnectAttempts++;
          
          if (this.unifiedConnection.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error(`[SSEManager] Max reconnection attempts reached. Closing connection.`);
            this.disconnect();
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
      
    } catch (error) {
      console.error(`[SSEManager] Failed to create EventSource:`, error);
    }
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
      console.warn('[SSEManager] Failed to get user email:', error);
    }
    
    // ✅ Build URL with user email as query parameter
    const url = new URL(`${getApiBase()}/jobs/${jobId}/workflow/stream`);
    if (userEmail) {
      url.searchParams.set('user-email', userEmail);
    }
    
    const finalUrl = url.toString();
    
    try {
      const eventSource = new EventSource(finalUrl, {
        withCredentials: true
      });
      
      eventSource.onopen = () => {
        const conn = this.workflowConnections.get(jobId);
        if (conn) {
          conn.isConnected = true;
        }
      };
      
      eventSource.onmessage = (event) => {
        try {
          const message: SSEMessage = JSON.parse(event.data);
          this.routeMessage(message);
        } catch (error) {
          console.error(`[SSEManager] Workflow parse error:`, error);
        }
      };
      
      // ✅ Handle 'end' event for workflow completion
      eventSource.addEventListener('end', () => {
        this.routeMessage({
          type: 'workflow',
          data: {
            jobId,
            eventType: 'end',
            isCompleted: true
          }
        });
      });
      
      eventSource.onerror = (error) => {
        console.error(`[SSEManager] Workflow connection error for ${jobId}:`, error);
        this.disconnectWorkflow(jobId);
      };
      
      this.workflowConnections.set(jobId, {
        eventSource,
        url: finalUrl,
        jobId,
        isConnected: false
      });
      
    } catch (error) {
      console.error(`[SSEManager] Failed to create workflow EventSource:`, error);
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
        console.error(`[SSEManager] Handler error for '${type}':`, error);
      }
    });
  }
  
  /**
   * Disconnect unified SSE
   */
  disconnect(): void {
    if (this.unifiedConnection) {
      try {
        this.unifiedConnection.eventSource.close();
      } catch (error) {
        console.error('[SSEManager] Error closing unified connection:', error);
      }
      this.unifiedConnection = null;
    }
  }
  
  /**
   * Disconnect workflow SSE
   */
  disconnectWorkflow(jobId: string): void {
    const conn = this.workflowConnections.get(jobId);
    if (conn) {
      try {
        conn.eventSource.close();
      } catch (error) {
        console.error('[SSEManager] Error closing workflow connection:', error);
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
  console.log('[SSEManager] Debug mode: sseManager available at window.__sseManager');
}
