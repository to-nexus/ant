import { StateCreator } from 'zustand';
import type { TransferRequest } from '@/infrastructure/http/api';

export interface TransferState {
  // Transfer tab sub-tab
  transferActiveSubTab: 'send' | 'receive';
  
  // Send: pre-selected source from explorer context menu
  sendPreselectedSource: {
    projectId: string;
    featureId: string;
    path: string;
    type: 'file' | 'directory';
  } | null;
  
  // Send target: self or other
  sendTarget: 'self' | 'other';
  
  // Receive badge count
  pendingTransferCount: number;
  
  // Received requests cache
  receivedRequests: TransferRequest[];
  sentRequests: TransferRequest[];
}

export interface TransferActions {
  openTransferTab(params?: {
    subTab?: 'send' | 'receive';
    preselectedSource?: {
      projectId: string;
      featureId: string;
      path: string;
      type: 'file' | 'directory';
    };
  }): void;
  setTransferSubTab(subTab: 'send' | 'receive'): void;
  setSendTarget(target: 'self' | 'other'): void;
  clearSendPreselectedSource(): void;
  setPendingTransferCount(count: number): void;
  incrementPendingTransferCount(): void;
  decrementPendingTransferCount(): void;
  setReceivedRequests(requests: TransferRequest[]): void;
  setSentRequests(requests: TransferRequest[]): void;
}

export type TransferSlice = TransferState & TransferActions;

export const createTransferSlice: StateCreator<any, [], [], TransferSlice> = (set, get) => ({
  // State
  transferActiveSubTab: 'send',
  sendPreselectedSource: null,
  sendTarget: 'self',
  pendingTransferCount: 0,
  receivedRequests: [],
  sentRequests: [],

  // Actions
  openTransferTab: (params) => {
    const state = get();
    
    // Open transfer tab
    const newOrder = state.mainPanelTabOrder.filter((t: string) => t !== 'transfer');
    newOrder.push('transfer');
    
    set({
      mainPanelActiveTab: 'transfer',
      mainPanelOpenTabs: {
        ...state.mainPanelOpenTabs,
        transfer: true,
      },
      mainPanelTabOrder: newOrder,
      ...(params?.subTab ? { transferActiveSubTab: params.subTab } : {}),
      ...(params?.preselectedSource ? { sendPreselectedSource: params.preselectedSource } : {}),
    });
  },

  setTransferSubTab: (subTab) => {
    set({ transferActiveSubTab: subTab });
  },

  setSendTarget: (target) => {
    set({ sendTarget: target });
  },

  clearSendPreselectedSource: () => {
    set({ sendPreselectedSource: null });
  },

  setPendingTransferCount: (count) => {
    set({ pendingTransferCount: count });
  },

  incrementPendingTransferCount: () => {
    set((s: any) => ({ pendingTransferCount: s.pendingTransferCount + 1 }));
  },

  decrementPendingTransferCount: () => {
    set((s: any) => ({ pendingTransferCount: Math.max(0, s.pendingTransferCount - 1) }));
  },

  setReceivedRequests: (requests) => {
    set({ receivedRequests: requests });
  },

  setSentRequests: (requests) => {
    set({ sentRequests: requests });
  },
});
