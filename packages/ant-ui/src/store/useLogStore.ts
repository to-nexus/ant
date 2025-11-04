import { create } from 'zustand';

export interface LogEntry {
  type: 'info' | 'stdout' | 'stderr' | 'error';
  message: string;
  timestamp: string;
}

interface LogStoreState {
  logs: LogEntry[];
  addLog: (log: LogEntry) => void;
  clearLogs: () => void;
}

export const useLogStore = create<LogStoreState>((set) => ({
  logs: [],
  addLog: (log) => set((state) => ({ logs: [...state.logs, log] })),
  clearLogs: () => set({ logs: [] }),
}));