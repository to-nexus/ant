import { LogEntry } from '../../../../../../core/ports/http';

/**
 * LogManager
 * 
 * Manages dev server logs storage and retrieval
 */
export class LogManager {
  private devServerLogs: Map<string, LogEntry[]> = new Map();
  
  /**
   * Append log entry
   */
  appendLog(serverKey: string, type: 'stdout' | 'stderr', message: string): LogEntry {
    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      type,
      message: message.trim()
    };
    
    const logs = this.devServerLogs.get(serverKey) || [];
    logs.push(logEntry);
    
    // Keep last 1000 lines
    if (logs.length > 1000) {
      logs.shift();
    }
    
    this.devServerLogs.set(serverKey, logs);
    
    return logEntry;
  }
  
  /**
   * Get all logs for a server
   */
  getLogs(serverKey: string): LogEntry[] {
    return this.devServerLogs.get(serverKey) || [];
  }
  
  /**
   * Clear logs for a server
   */
  clearLogs(serverKey: string): void {
    this.devServerLogs.delete(serverKey);
  }
  
  /**
   * Clear all logs
   */
  clearAllLogs(): void {
    this.devServerLogs.clear();
  }
}

