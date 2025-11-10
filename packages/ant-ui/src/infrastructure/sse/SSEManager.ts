/**
 * SSEManager - Singleton SSE Connection Manager
 * 
 * Responsibilities:
 * - EventSource 인스턴스 생성/관리
 * - 연결 상태 모니터링
 * - 자동 재연결 (EventSource 내장 기능 활용)
 * - Store에 데이터 전달
 * 
 * Architecture:
 * - React와 완전 독립
 * - 애플리케이션 생명주기 동안 단 1개 인스턴스 (Singleton)
 * - 메모리 누수 방지를 위한 cleanup 보장
 * 
 * Usage:
 *   sseManager.connect('kanban', url, (data) => {
 *     useStore.getState().updateKanban(data);
 *   });
 * 
 * @see packages/ant-ui/ARCHITECTURE.md
 */

export type SSEMessageHandler = (data: any) => void;

interface SSEConnection {
  eventSource: EventSource;
  url: string;
  onMessage: SSEMessageHandler;
  isConnected: boolean;
  reconnectAttempts: number;
}

class SSEManager {
  private connections: Map<string, SSEConnection> = new Map();
  private maxReconnectAttempts = 5;
  
  /**
   * SSE 연결 생성
   * @param key - 연결 식별자 (예: 'kanban', 'workflow', 'chat', 'fileTree')
   * @param url - SSE 엔드포인트 URL
   * @param onMessage - 메시지 수신 콜백 (Store 업데이트)
   */
  connect(key: string, url: string, onMessage: SSEMessageHandler): void {
    // 이미 연결되어 있으면 무시
    if (this.connections.has(key)) {
      console.warn(`[SSEManager] Connection '${key}' already exists. Ignoring duplicate connect.`);
      return;
    }
    
    console.log(`[SSEManager] 🔌 Connecting to '${key}': ${url}`);
    
    try {
      const eventSource = new EventSource(url, {
        withCredentials: false // CORS 설정에 따라 조정 가능
      });
      
      eventSource.onopen = () => {
        console.log(`[SSEManager] ✅ '${key}' connection opened successfully`);
        const conn = this.connections.get(key);
        if (conn) {
          conn.isConnected = true;
          conn.reconnectAttempts = 0; // 연결 성공 시 재시도 카운트 리셋
        }
      };
      
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // ✅ Workflow만 로그 출력
          if (key === 'workflow') {
            console.log(`[SSEManager] 📨 WORKFLOW message:`, {
              jobId: data.jobId,
              currentNode: data.currentNode,
              previousNode: data.previousNode,
              activeActors: data.activeActors
            });
          }
          // ✅ Chat 메시지 디버깅
          if (key === 'chat') {
            console.log(`[SSEManager] 💬 CHAT message received:`, data);
          }
          // ✅ Store에 직접 업데이트 (React 외부에서 실행)
          onMessage(data);
        } catch (error) {
          console.error(`[SSEManager] ❌ '${key}' parse error:`, error);
          console.error('[SSEManager] Raw data:', event.data);
        }
      };
      
      eventSource.onerror = (error) => {
        console.error(`[SSEManager] ⚠️  '${key}' connection error:`, error);
        const conn = this.connections.get(key);
        if (conn) {
          conn.isConnected = false;
          conn.reconnectAttempts++;
          
          // 최대 재시도 횟수 초과 시 연결 종료
          if (conn.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error(`[SSEManager] ❌ '${key}' max reconnection attempts reached. Closing connection.`);
            this.disconnect(key);
          } else {
            console.log(`[SSEManager] 🔄 '${key}' will auto-reconnect (attempt ${conn.reconnectAttempts}/${this.maxReconnectAttempts})...`);
            // EventSource가 자동으로 재연결 시도함
          }
        }
      };
      
      this.connections.set(key, {
        eventSource,
        url,
        onMessage,
        isConnected: false, // onopen에서 true로 변경됨
        reconnectAttempts: 0
      });
    } catch (error) {
      console.error(`[SSEManager] ❌ Failed to create EventSource for '${key}':`, error);
    }
  }
  
  /**
   * SSE 연결 종료
   * @param key - 연결 식별자
   */
  disconnect(key: string): void {
    const connection = this.connections.get(key);
    if (!connection) {
      console.warn(`[SSEManager] Connection '${key}' not found. Nothing to disconnect.`);
      return;
    }
    
    console.log(`[SSEManager] 🔌 Disconnecting '${key}'...`);
    
    try {
      connection.eventSource.close();
      this.connections.delete(key);
      console.log(`[SSEManager] ✅ '${key}' disconnected successfully`);
    } catch (error) {
      console.error(`[SSEManager] ❌ Error disconnecting '${key}':`, error);
      // 에러가 발생해도 Map에서는 제거
      this.connections.delete(key);
    }
  }
  
  /**
   * 모든 SSE 연결 종료
   * App unmount 시 호출
   */
  disconnectAll(): void {
    const connectionCount = this.connections.size;
    console.log(`[SSEManager] 🔌 Disconnecting all connections (${connectionCount} total)...`);
    
    // forEach는 내부에서 delete를 호출하므로 Array.from으로 복사 후 처리
    const keys = Array.from(this.connections.keys());
    keys.forEach((key) => {
      this.disconnect(key);
    });
    
    console.log('[SSEManager] ✅ All connections disconnected');
  }
  
  /**
   * 연결 상태 확인
   * @param key - 연결 식별자
   * @returns 연결 여부
   */
  isConnected(key: string): boolean {
    return this.connections.get(key)?.isConnected ?? false;
  }
  
  /**
   * 현재 활성 연결 목록
   * @returns 연결 키 배열
   */
  getActiveConnections(): string[] {
    return Array.from(this.connections.keys());
  }
  
  /**
   * 연결 정보 조회 (디버깅용)
   * @param key - 연결 식별자
   * @returns 연결 정보
   */
  getConnectionInfo(key: string): { url: string; isConnected: boolean; reconnectAttempts: number } | null {
    const conn = this.connections.get(key);
    if (!conn) return null;
    
    return {
      url: conn.url,
      isConnected: conn.isConnected,
      reconnectAttempts: conn.reconnectAttempts
    };
  }
  
  /**
   * 모든 연결 정보 조회 (디버깅용)
   */
  getAllConnectionInfo(): Record<string, { url: string; isConnected: boolean; reconnectAttempts: number }> {
    const info: Record<string, any> = {};
    this.connections.forEach((conn, key) => {
      info[key] = {
        url: conn.url,
        isConnected: conn.isConnected,
        reconnectAttempts: conn.reconnectAttempts
      };
    });
    return info;
  }
}

// ✅ Singleton 인스턴스 export
// 애플리케이션 전체에서 단 하나의 SSEManager만 존재
export const sseManager = new SSEManager();

// 디버깅용: window 객체에 노출 (개발 환경에서만)
if (import.meta.env.DEV) {
  (window as any).__sseManager = sseManager;
  console.log('[SSEManager] 🐛 Debug mode: sseManager available at window.__sseManager');
}

