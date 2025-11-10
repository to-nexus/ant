export interface LogEntry {
  type: 'info' | 'stdout' | 'stderr' | 'error';
  message: string;
  timestamp: string;
}
