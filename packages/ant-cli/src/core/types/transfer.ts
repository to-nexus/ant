/**
 * Artifact Transfer Types
 * 
 * Types for file/directory transfer between projects, features, and users.
 */

/**
 * Transfer request for cross-user transfers (requires approval).
 * Stored in Redis with 7-day TTL.
 */
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

/**
 * Parameters for self-transfer (own projects/features)
 */
export interface TransferParams {
  userContext: { userId: string; organizationId: string };
  source: { projectId: string; featureId: string; path: string };
  destination: { projectId: string; featureId: string; path: string };
  mode: 'copy' | 'move';
}

/**
 * Parameters for cross-user transfer request.
 * Cross-user transfers are always 'copy' mode (original is always preserved).
 */
export interface TransferRequestParams {
  sender: { orgId: string; userId: string };
  recipient: { orgId: string; userId: string };
  source: { projectId: string; featureId: string; path: string };
  destination: { projectId: string; featureId: string; path: string };
}

/**
 * Result of a transfer operation
 */
export interface TransferResult {
  success: boolean;
  filesTransferred: number;
  skipped?: string[];
  errors?: string[];
}

/**
 * Standard error response for transfer APIs
 */
export interface TransferErrorResponse {
  error: string;
  message: string;
  details?: string;
}

/**
 * Transfer error codes
 */
export const TRANSFER_ERROR_CODES = {
  INVALID_PATH: 'INVALID_PATH',
  SESSION_PATH_BLOCKED: 'SESSION_PATH_BLOCKED',
  MOVE_CANONICAL_BLOCKED: 'MOVE_CANONICAL_BLOCKED',
  SAME_PATH: 'SAME_PATH',
  SOURCE_NOT_FOUND: 'SOURCE_NOT_FOUND',
  DEST_PROJECT_NOT_FOUND: 'DEST_PROJECT_NOT_FOUND',
  DEST_FEATURE_NOT_FOUND: 'DEST_FEATURE_NOT_FOUND',
  TRANSFER_IN_PROGRESS: 'TRANSFER_IN_PROGRESS',
  IO_ERROR: 'IO_ERROR',
  SELF_TRANSFER_NOT_ALLOWED: 'SELF_TRANSFER_NOT_ALLOWED',
  ORG_MISMATCH: 'ORG_MISMATCH',
  RECIPIENT_NOT_FOUND: 'RECIPIENT_NOT_FOUND',
  SNAPSHOT_ERROR: 'SNAPSHOT_ERROR',
  NOT_RECIPIENT: 'NOT_RECIPIENT',
  NOT_SENDER: 'NOT_SENDER',
  REQUEST_NOT_FOUND: 'REQUEST_NOT_FOUND',
  ALREADY_RESOLVED: 'ALREADY_RESOLVED',
  REQUEST_EXPIRED: 'REQUEST_EXPIRED',
  PAYLOAD_MISSING: 'PAYLOAD_MISSING',
  NOT_PENDING: 'NOT_PENDING',
} as const;

/**
 * Error code to user-facing message mapping
 */
export const TRANSFER_ERROR_MESSAGES: Record<string, string> = {
  [TRANSFER_ERROR_CODES.INVALID_PATH]: '유효하지 않은 경로입니다.',
  [TRANSFER_ERROR_CODES.SESSION_PATH_BLOCKED]: '세션 데이터는 전송할 수 없습니다.',
  [TRANSFER_ERROR_CODES.MOVE_CANONICAL_BLOCKED]: '시스템 디렉토리는 이동할 수 없습니다. 복사를 사용하세요.',
  [TRANSFER_ERROR_CODES.SAME_PATH]: '같은 위치로는 전송할 수 없습니다.',
  [TRANSFER_ERROR_CODES.SOURCE_NOT_FOUND]: '원본 파일을 찾을 수 없습니다.',
  [TRANSFER_ERROR_CODES.DEST_PROJECT_NOT_FOUND]: '대상 프로젝트를 찾을 수 없습니다.',
  [TRANSFER_ERROR_CODES.DEST_FEATURE_NOT_FOUND]: '대상 피처를 찾을 수 없습니다.',
  [TRANSFER_ERROR_CODES.TRANSFER_IN_PROGRESS]: '해당 위치에 다른 전송이 진행 중입니다. 잠시 후 다시 시도하세요.',
  [TRANSFER_ERROR_CODES.IO_ERROR]: '파일 전송 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.',
  [TRANSFER_ERROR_CODES.SELF_TRANSFER_NOT_ALLOWED]: "자신에게는 '나에게 보내기'를 사용하세요.",
  [TRANSFER_ERROR_CODES.ORG_MISMATCH]: '같은 조직의 구성원에게만 전송할 수 있습니다.',
  [TRANSFER_ERROR_CODES.RECIPIENT_NOT_FOUND]: '받는 사람을 찾을 수 없습니다. 조직에 존재하는 구성원인지 확인하세요.',
  [TRANSFER_ERROR_CODES.SNAPSHOT_ERROR]: '전송 요청 생성 중 오류가 발생했습니다.',
  [TRANSFER_ERROR_CODES.NOT_RECIPIENT]: '이 요청을 처리할 권한이 없습니다.',
  [TRANSFER_ERROR_CODES.NOT_SENDER]: '이 요청을 취소할 권한이 없습니다.',
  [TRANSFER_ERROR_CODES.REQUEST_NOT_FOUND]: '전송 요청을 찾을 수 없습니다.',
  [TRANSFER_ERROR_CODES.ALREADY_RESOLVED]: '이미 처리된 요청입니다.',
  [TRANSFER_ERROR_CODES.REQUEST_EXPIRED]: '만료된 요청입니다.',
  [TRANSFER_ERROR_CODES.PAYLOAD_MISSING]: '전송 데이터를 찾을 수 없습니다. 다시 요청해 주세요.',
  [TRANSFER_ERROR_CODES.NOT_PENDING]: '이미 처리된 요청은 취소할 수 없습니다.',
};
