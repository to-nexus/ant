import { API_BASE, apiGet, apiPost, apiDelete } from './client';

export interface TransferRequest {
  id: string;
  sender: { orgId: string; userId: string };
  recipient: { orgId: string; userId: string };
  source: { projectId: string; featureId: string; path: string };
  destination: { projectId: string; featureId: string; path: string };
  mode: 'copy' | 'move';
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired' | 'completed';
  createdAt: string;
  expiresAt: string;
  payloadPath: string;
  /** Number of files in the payload (for directory transfers) */
  fileCount?: number;
}

export interface TransferResult {
  success: boolean;
  filesTransferred: number;
  skipped?: string[];
  errors?: string[];
}

/** Self-transfer (immediate, no approval) */
export function transferArtifact(params: {
  source: { projectId: string; featureId: string; path: string };
  destination: { projectId: string; featureId: string; path: string };
  mode: 'copy' | 'move';
}): Promise<TransferResult> {
  return apiPost(`${API_BASE()}/artifacts/transfer`, params);
}

/** Cross-user transfer request (requires approval) */
export function requestTransfer(params: {
  recipient: { userId: string; orgId?: string };
  source: { projectId: string; featureId: string; path: string };
  destination: { projectId: string; featureId: string; path: string };
}): Promise<TransferRequest> {
  return apiPost(`${API_BASE()}/artifacts/transfer-request`, params);
}

/** List transfer requests (received or sent) */
export function fetchTransferRequests(
  direction: 'received' | 'sent' = 'received',
  status?: string,
): Promise<{ requests: TransferRequest[]; count: number; pendingCount: number }> {
  const params = new URLSearchParams({ direction });
  if (status) params.set('status', status);
  return apiGet(`${API_BASE()}/artifacts/transfer-requests?${params}`);
}

/** Resolve (approve/reject) a transfer request */
export function resolveTransferRequest(
  requestId: string,
  action: 'approve' | 'reject',
): Promise<TransferRequest> {
  return apiPost(`${API_BASE()}/artifacts/transfer-requests/${requestId}/resolve`, { action });
}

/** Cancel a pending transfer request */
export function cancelTransferRequest(requestId: string): Promise<TransferRequest> {
  return apiPost(`${API_BASE()}/artifacts/transfer-requests/${requestId}/cancel`);
}

/** Delete a completed transfer request from history (sender only) */
export function deleteTransferRequest(
  requestId: string,
): Promise<{ success: boolean; id: string }> {
  return apiDelete(`${API_BASE()}/artifacts/transfer-requests/${requestId}`);
}
