/**
 * ArtifactTransferService
 * 
 * Business logic for transferring artifacts (files/directories) between
 * projects, features, and users. Handles both self-transfer (immediate)
 * and cross-user transfer (approval-based).
 * 
 * Key features:
 * - Redis distributed locking for concurrent transfer serialization
 * - sessions/ directory auto-exclusion
 * - Merge semantics for directory transfers
 * - Canonical directory move protection
 * - Snapshot-based cross-user transfers with 7-day expiry
 */

import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { WorkspaceResolver } from '../../core/config/WorkspacePathResolver';
import { RedisStateStore } from '../state/RedisStateStore';
import { REDIS_KEYS, REDIS_TTL } from '../state/redisConstants';
import { logger } from '../../utils/logger';
import { isCanonicalDir, CANONICAL_FEATURE_DIRS, clearCanonicalDirectory } from '../../core/utils/sessionPaths';
import type { UserContext } from '../../core/types/user';
import type {
  TransferParams,
  TransferResult,
  TransferRequest,
  TransferRequestParams,
} from '../../core/types/transfer';
import { TRANSFER_ERROR_CODES } from '../../core/types/transfer';

const COMPONENT = 'ArtifactTransferService';

/**
 * Check if a path is under sessions/ directory
 */
function isSessionPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  return normalized === 'sessions' || normalized.startsWith('sessions/');
}

export class ArtifactTransferService {
  private readonly workspaceResolver: WorkspaceResolver;
  private readonly stateStore: RedisStateStore;

  constructor(workspaceResolver: WorkspaceResolver, stateStore: RedisStateStore) {
    this.workspaceResolver = workspaceResolver;
    this.stateStore = stateStore;
  }

  // ============================================
  // Self-Transfer (Immediate, No Approval)
  // ============================================

  /**
   * Transfer files/directories between own projects/features.
   * Executes immediately without approval.
   */
  async transferOwn(params: TransferParams): Promise<TransferResult> {
    const { userContext, source, destination, mode } = params;

    // Validate paths (same location = same project + feature)
    const sameLocation = source.projectId === destination.projectId && source.featureId === destination.featureId;
    this.validateTransferPaths(source.path, destination.path, mode, sameLocation);

    const srcUserContext: UserContext = {
      userId: userContext.userId,
      organizationId: userContext.organizationId,
    };

    // Resolve full paths
    const srcFeaturePath = this.workspaceResolver.getFeaturePath(
      srcUserContext, source.projectId, source.featureId
    );
    const destFeaturePath = this.workspaceResolver.getFeaturePath(
      srcUserContext, destination.projectId, destination.featureId
    );

    const srcFullPath = path.join(srcFeaturePath, source.path);
    const destFullPath = path.join(destFeaturePath, destination.path);

    // Verify source exists
    if (!fs.existsSync(srcFullPath)) {
      throw this.createError(404, TRANSFER_ERROR_CODES.SOURCE_NOT_FOUND);
    }

    // Verify destination project/feature exist
    if (!fs.existsSync(this.workspaceResolver.getProjectPath(srcUserContext, destination.projectId))) {
      throw this.createError(404, TRANSFER_ERROR_CODES.DEST_PROJECT_NOT_FOUND);
    }
    if (!fs.existsSync(destFeaturePath)) {
      throw this.createError(404, TRANSFER_ERROR_CODES.DEST_FEATURE_NOT_FOUND);
    }

    // Acquire distributed lock for destination
    const lockKey = this.buildLockKey(
      userContext.organizationId, userContext.userId,
      destination.projectId, destination.featureId, destination.path
    );
    const lockAcquired = await this.stateStore.acquireLock(lockKey, REDIS_TTL.TRANSFER.LOCK);
    if (!lockAcquired) {
      throw this.createError(409, TRANSFER_ERROR_CODES.TRANSFER_IN_PROGRESS);
    }

    try {
      const srcStat = await fs.promises.stat(srcFullPath);
      const result: TransferResult = { success: true, filesTransferred: 0, skipped: [] };

      if (srcStat.isDirectory()) {
        // Directory transfer with merge semantics, sessions/ excluded
        const count = await this.copyDirectoryWithExclusions(srcFullPath, destFullPath);
        result.filesTransferred = count.files;
        if (count.sessionsSkipped) {
          result.skipped!.push('sessions/');
        }

        if (mode === 'move') {
          // Remove source (but preserve canonical dirs if at feature root)
          await this.removeSourceAfterMove(srcFullPath, source.path);
        }
      } else {
        // Single file transfer
        await fs.promises.mkdir(path.dirname(destFullPath), { recursive: true });
        await fs.promises.copyFile(srcFullPath, destFullPath);
        result.filesTransferred = 1;

        if (mode === 'move') {
          await fs.promises.unlink(srcFullPath);
        }
      }

      // Verify destination exists (EFS propagation delay handling)
      await this.verifyDestination(destFullPath);

      logger.info(`📦 [${COMPONENT}] Self-transfer completed: ${source.path} → ${destination.path} (${mode}, ${result.filesTransferred} files)`, { component: COMPONENT });
      return result;
    } catch (error: any) {
      if (error.httpStatus) throw error; // Re-throw known errors
      logger.error(`📦 [${COMPONENT}] Self-transfer failed: src=${srcFullPath}, dest=${destFullPath}, mode=${mode}, error=${error.message}`, { component: COMPONENT }, error);
      throw this.createError(500, TRANSFER_ERROR_CODES.IO_ERROR, error.message);
    } finally {
      await this.stateStore.releaseLock(lockKey);
    }
  }

  // ============================================
  // Cross-User Transfer (Approval Required)
  // ============================================

  /**
   * Create a transfer request to another user.
   * Creates a snapshot in .transfers/ and notifies recipient.
   */
  async requestTransfer(params: TransferRequestParams): Promise<TransferRequest> {
    const { sender, recipient, source, destination } = params;
    // Cross-user transfers are always copy (original is preserved)
    const mode: 'copy' | 'move' = 'copy';

    // Validate same org
    if (sender.orgId !== recipient.orgId) {
      throw this.createError(403, TRANSFER_ERROR_CODES.ORG_MISMATCH);
    }

    // Validate not self
    if (sender.userId === recipient.userId) {
      throw this.createError(400, TRANSFER_ERROR_CODES.SELF_TRANSFER_NOT_ALLOWED);
    }

    // Validate paths
    this.validateTransferPaths(source.path, destination.path, mode);

    // Verify recipient exists (check if their workspace directory exists)
    const recipientUserContext: UserContext = {
      userId: recipient.userId,
      organizationId: recipient.orgId,
    };
    const recipientWorkspace = path.join(
      this.workspaceResolver.getPhysicalWorkspacesPath(),
      recipient.orgId,
      recipient.userId
    );
    if (!fs.existsSync(recipientWorkspace)) {
      throw this.createError(404, TRANSFER_ERROR_CODES.RECIPIENT_NOT_FOUND);
    }

    // Verify recipient's destination project/feature exist
    if (!fs.existsSync(this.workspaceResolver.getProjectPath(recipientUserContext, destination.projectId))) {
      throw this.createError(404, TRANSFER_ERROR_CODES.DEST_PROJECT_NOT_FOUND);
    }
    if (!fs.existsSync(this.workspaceResolver.getFeaturePath(recipientUserContext, destination.projectId, destination.featureId))) {
      throw this.createError(404, TRANSFER_ERROR_CODES.DEST_FEATURE_NOT_FOUND);
    }

    // Verify source exists
    const senderUserContext: UserContext = {
      userId: sender.userId,
      organizationId: sender.orgId,
    };
    const srcFeaturePath = this.workspaceResolver.getFeaturePath(
      senderUserContext, source.projectId, source.featureId
    );
    const srcFullPath = path.join(srcFeaturePath, source.path);
    if (!fs.existsSync(srcFullPath)) {
      throw this.createError(404, TRANSFER_ERROR_CODES.SOURCE_NOT_FOUND);
    }

    // Create snapshot
    const requestId = uuidv4();
    const transfersDir = path.join(
      this.workspaceResolver.getPhysicalWorkspacesPath(),
      sender.orgId,
      '.transfers',
      requestId
    );
    const payloadDir = path.join(transfersDir, 'payload');

    let fileCount: number | undefined;
    try {
      await fs.promises.mkdir(payloadDir, { recursive: true });

      const srcStat = await fs.promises.stat(srcFullPath);
      if (srcStat.isDirectory()) {
        const result = await this.copyDirectoryWithExclusions(srcFullPath, payloadDir);
        fileCount = result.files;
      } else {
        await fs.promises.copyFile(srcFullPath, path.join(payloadDir, path.basename(source.path)));
        fileCount = 1;
      }
    } catch (error: any) {
      // Clean up partial snapshot
      try { await fs.promises.rm(transfersDir, { recursive: true, force: true }); } catch {}
      throw this.createError(500, TRANSFER_ERROR_CODES.SNAPSHOT_ERROR, error.message);
    }

    // Create request metadata
    const now = new Date();
    const expiresAt = new Date(now.getTime() + REDIS_TTL.TRANSFER.REQUEST * 1000);

    const request: TransferRequest = {
      id: requestId,
      sender,
      recipient,
      source,
      destination,
      mode,
      status: 'pending',
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      payloadPath: payloadDir,
      fileCount,
    };

    // Store in Redis
    await this.stateStore.createTransferRequest(request);

    // Write backup metadata to EFS
    try {
      await fs.promises.writeFile(
        path.join(transfersDir, 'metadata.json'),
        JSON.stringify(request, null, 2),
        'utf-8'
      );
    } catch {
      // Non-critical: Redis is primary
    }

    logger.info(`📦 [${COMPONENT}] Transfer request created: ${requestId} (${sender.userId} → ${recipient.userId})`, { component: COMPONENT });
    return request;
  }

  /**
   * Approve or reject a transfer request.
   * @param excludePaths - Payload-relative paths to skip when copying (recipient opt-out)
   */
  async resolveTransfer(
    requestId: string,
    action: 'approve' | 'reject',
    recipientUserId: string,
    recipientOrgId: string,
    excludePaths?: string[]
  ): Promise<TransferRequest> {
    const request = await this.stateStore.getTransferRequest(requestId);
    if (!request) {
      throw this.createError(404, TRANSFER_ERROR_CODES.REQUEST_NOT_FOUND);
    }

    // Verify recipient
    if (request.recipient.userId !== recipientUserId || request.recipient.orgId !== recipientOrgId) {
      throw this.createError(403, TRANSFER_ERROR_CODES.NOT_RECIPIENT);
    }

    // Check status
    if (request.status !== 'pending') {
      if (request.status === 'expired') {
        throw this.createError(410, TRANSFER_ERROR_CODES.REQUEST_EXPIRED);
      }
      throw this.createError(409, TRANSFER_ERROR_CODES.ALREADY_RESOLVED);
    }

    // Check expiry
    if (new Date() > new Date(request.expiresAt)) {
      await this.stateStore.updateTransferRequestStatus(requestId, 'expired');
      throw this.createError(410, TRANSFER_ERROR_CODES.REQUEST_EXPIRED);
    }

    if (action === 'approve') {
      // Verify payload exists
      if (!fs.existsSync(request.payloadPath)) {
        logger.error(`📦 [${COMPONENT}] Payload missing at: ${request.payloadPath}`, { component: COMPONENT });
        throw this.createError(500, TRANSFER_ERROR_CODES.PAYLOAD_MISSING);
      }

      // Copy payload to destination
      const recipientUserContext: UserContext = {
        userId: request.recipient.userId,
        organizationId: request.recipient.orgId,
      };
      const destFeaturePath = this.workspaceResolver.getFeaturePath(
        recipientUserContext, request.destination.projectId, request.destination.featureId
      );
      const destFullPath = path.join(destFeaturePath, request.destination.path);

      logger.info(`📦 [${COMPONENT}] Resolve approve: payload=${request.payloadPath}, dest=${destFullPath}`, { component: COMPONENT });

      // Acquire lock
      const lockKey = this.buildLockKey(
        request.recipient.orgId, request.recipient.userId,
        request.destination.projectId, request.destination.featureId,
        request.destination.path
      );
      const lockAcquired = await this.stateStore.acquireLock(lockKey, REDIS_TTL.TRANSFER.LOCK);
      if (!lockAcquired) {
        throw this.createError(409, TRANSFER_ERROR_CODES.TRANSFER_IN_PROGRESS);
      }

      try {
        // Determine if payload is a single file transfer or directory transfer.
        // Single file: payload contains exactly one file whose name matches the source basename.
        // Directory: payload contains the directory's contents (may be 1+ entries).
        const payloadEntries = await fs.promises.readdir(request.payloadPath);
        logger.info(`📦 [${COMPONENT}] Resolve: payloadEntries=${JSON.stringify(payloadEntries)}, source.path=${request.source.path}, dest=${destFullPath}`, { component: COMPONENT });

        const isSingleFileTransfer =
          payloadEntries.length === 1 &&
          payloadEntries[0] === path.basename(request.source.path) &&
          (await fs.promises.stat(path.join(request.payloadPath, payloadEntries[0]))).isFile();

        const excludeSet = excludePaths && excludePaths.length > 0
          ? new Set(excludePaths.map(p => p.replace(/\\/g, '/')))
          : undefined;

        if (isSingleFileTransfer) {
          const fileName = payloadEntries[0];
          if (excludeSet?.has(fileName)) {
            logger.info(`📦 [${COMPONENT}] Single file excluded by recipient: ${fileName}`, { component: COMPONENT });
          } else {
            const singleEntry = path.join(request.payloadPath, fileName);
            await fs.promises.mkdir(path.dirname(destFullPath), { recursive: true });
            await fs.promises.copyFile(singleEntry, destFullPath);
          }
        } else {
          await this.copyDirectoryWithExclusions(request.payloadPath, destFullPath, excludeSet);
        }

        // Handle move: remove original source if mode is 'move'
        if (request.mode === 'move') {
          const senderUserContext: UserContext = {
            userId: request.sender.userId,
            organizationId: request.sender.orgId,
          };
          const srcFeaturePath = this.workspaceResolver.getFeaturePath(
            senderUserContext, request.source.projectId, request.source.featureId
          );
          const srcFullPath = path.join(srcFeaturePath, request.source.path);
          if (fs.existsSync(srcFullPath)) {
            await this.removeSourceAfterMove(srcFullPath, request.source.path);
          }
        }

        // Cleanup snapshot
        const transfersDir = path.dirname(request.payloadPath);
        try { await fs.promises.rm(transfersDir, { recursive: true, force: true }); } catch {}

        await this.stateStore.updateTransferRequestStatus(requestId, 'approved');
      } catch (error: any) {
        if (error.httpStatus) throw error;
        logger.error(`📦 [${COMPONENT}] Resolve approve failed: ${error.message}`, { component: COMPONENT }, error);
        throw this.createError(500, TRANSFER_ERROR_CODES.IO_ERROR, error.message);
      } finally {
        await this.stateStore.releaseLock(lockKey);
      }
    } else {
      // Reject: cleanup snapshot
      const transfersDir = path.dirname(request.payloadPath);
      try { await fs.promises.rm(transfersDir, { recursive: true, force: true }); } catch {}

      await this.stateStore.updateTransferRequestStatus(requestId, 'rejected');
    }

    const updated = await this.stateStore.getTransferRequest(requestId);
    logger.info(`📦 [${COMPONENT}] Transfer ${requestId} ${action}d`, { component: COMPONENT });
    return updated!;
  }

  /**
   * Cancel a pending transfer request (sender only).
   */
  async cancelTransfer(
    requestId: string,
    senderUserId: string,
    senderOrgId: string
  ): Promise<TransferRequest> {
    const request = await this.stateStore.getTransferRequest(requestId);
    if (!request) {
      throw this.createError(404, TRANSFER_ERROR_CODES.REQUEST_NOT_FOUND);
    }

    // Verify sender
    if (request.sender.userId !== senderUserId || request.sender.orgId !== senderOrgId) {
      throw this.createError(403, TRANSFER_ERROR_CODES.NOT_SENDER);
    }

    // Only pending can be cancelled
    if (request.status !== 'pending') {
      throw this.createError(409, TRANSFER_ERROR_CODES.NOT_PENDING);
    }

    // Update status (snapshot cleanup deferred to expiry job)
    await this.stateStore.updateTransferRequestStatus(requestId, 'cancelled');

    const updated = await this.stateStore.getTransferRequest(requestId);
    logger.info(`📦 [${COMPONENT}] Transfer ${requestId} cancelled by sender`, { component: COMPONENT });
    return updated!;
  }

  // ============================================
  // Internal Helpers
  // ============================================

  /**
   * Validate transfer paths
   * @param srcPath - Source relative path
   * @param destPath - Destination relative path
   * @param mode - Transfer mode
   * @param sameLocation - True if source and destination are in the same project+feature
   */
  private validateTransferPaths(srcPath: string, destPath: string, mode: 'copy' | 'move', sameLocation: boolean = false): void {
    // Check empty paths
    if (!srcPath || !destPath) {
      throw this.createError(400, TRANSFER_ERROR_CODES.INVALID_PATH);
    }

    // Check path traversal
    if (srcPath.includes('..') || destPath.includes('..')) {
      throw this.createError(400, TRANSFER_ERROR_CODES.INVALID_PATH);
    }

    // Normalize paths
    const normalizedSrc = srcPath.replace(/\\/g, '/').replace(/\/$/, '');
    const normalizedDest = destPath.replace(/\\/g, '/').replace(/\/$/, '');

    // Check sessions paths
    if (isSessionPath(normalizedSrc) || isSessionPath(normalizedDest)) {
      throw this.createError(400, TRANSFER_ERROR_CODES.SESSION_PATH_BLOCKED);
    }

    // Check same path only when source and destination are truly the same location
    if (sameLocation && normalizedSrc === normalizedDest) {
      throw this.createError(400, TRANSFER_ERROR_CODES.SAME_PATH);
    }

    // Check canonical directory move
    if (mode === 'move' && isCanonicalDir(normalizedSrc)) {
      throw this.createError(400, TRANSFER_ERROR_CODES.MOVE_CANONICAL_BLOCKED);
    }
  }

  /**
   * Copy directory recursively with sessions/ exclusion and optional path exclusions.
   * @param excludePaths - Set of relative paths (relative to the original srcPath root) to skip.
   *                       Used to pass through recursion via `currentRelative`.
   * @param currentRelative - Internal: tracks the current relative path within the copy root.
   */
  private async copyDirectoryWithExclusions(
    srcPath: string,
    destPath: string,
    excludePaths?: Set<string>,
    currentRelative: string = ''
  ): Promise<{ files: number; sessionsSkipped: boolean }> {
    await fs.promises.mkdir(destPath, { recursive: true });
    
    let fileCount = 0;
    let sessionsSkipped = false;

    const entries = await fs.promises.readdir(srcPath, { withFileTypes: true });
    for (const entry of entries) {
      const srcEntry = path.join(srcPath, entry.name);
      const destEntry = path.join(destPath, entry.name);
      const entryRelative = currentRelative ? `${currentRelative}/${entry.name}` : entry.name;

      if (entry.name === 'sessions') {
        sessionsSkipped = true;
        continue;
      }

      if (excludePaths?.has(entryRelative)) {
        continue;
      }

      if (entry.isDirectory()) {
        const sub = await this.copyDirectoryWithExclusions(srcEntry, destEntry, excludePaths, entryRelative);
        fileCount += sub.files;
        sessionsSkipped = sessionsSkipped || sub.sessionsSkipped;
      } else {
        await fs.promises.copyFile(srcEntry, destEntry);
        fileCount++;
      }
    }

    return { files: fileCount, sessionsSkipped };
  }

  /**
   * Remove source after move, handling canonical directories.
   * Delegates to the shared clearCanonicalDirectory utility with sessions skip.
   */
  private async removeSourceAfterMove(srcFullPath: string, relativePath: string): Promise<void> {
    const stat = await fs.promises.stat(srcFullPath);
    if (stat.isDirectory()) {
      await clearCanonicalDirectory(srcFullPath, relativePath, { skipSessions: true });
    } else {
      await fs.promises.unlink(srcFullPath);
    }
  }

  /**
   * Verify destination exists with retry (EFS propagation delay).
   */
  private async verifyDestination(destPath: string, retries = 3, delayMs = 500): Promise<void> {
    for (let i = 0; i < retries; i++) {
      if (fs.existsSync(destPath)) return;
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    // Don't throw - best-effort verification
    logger.warn(`📦 [${COMPONENT}] Destination verification failed after ${retries} retries: ${destPath}`, { component: COMPONENT });
  }

  /**
   * Build Redis lock key for a destination.
   */
  private buildLockKey(
    orgId: string, userId: string,
    projectId: string, featureId: string, destPath: string
  ): string {
    return `${REDIS_KEYS.TRANSFER.LOCK}${orgId}:${userId}:${projectId}:${featureId}:${destPath}`;
  }

  /**
   * Create a typed error with HTTP status and error code.
   */
  private createError(httpStatus: number, code: string, details?: string): any {
    const error: any = new Error(code);
    error.httpStatus = httpStatus;
    error.code = code;
    error.details = details;
    return error;
  }
}
