/**
 * Bridge Session Manager
 * 
 * Manages companion app WebSocket sessions via Redis.
 * Used by:
 * - RealtimeServer: to register/update/remove bridge sessions
 * - API Server: to check bridge status (GET /api/bridge/status)
 * - Job Worker: to verify MCP availability (via BridgeMCPTransport)
 * 
 * Sessions use two key patterns:
 * - `ant:bridge:session:{userId}` — authenticated (full MCP relay)
 * - `ant:bridge:probe:{machineId}` — unauthenticated probe (detected only)
 */

import type { BridgeSession, BridgeStatusResponse } from '@ant/shared';
import { BRIDGE_HEARTBEAT_TIMEOUT_MS } from '@ant/shared';

const BRIDGE_SESSION_PREFIX = 'ant:bridge:session:';
const BRIDGE_PROBE_KEY = 'ant:bridge:probe';

export class BridgeSessionManager {
  private stateStore: any;

  constructor(stateStore: any) {
    this.stateStore = stateStore;
  }

  async getSession(userId: string): Promise<BridgeSession | null> {
    if (!this.stateStore) return null;
    try {
      const raw = await this.stateStore.getKey(`${BRIDGE_SESSION_PREFIX}${userId}`);
      if (!raw) return null;
      return JSON.parse(raw) as BridgeSession;
    } catch {
      return null;
    }
  }

  async setSession(userId: string, session: BridgeSession): Promise<void> {
    if (!this.stateStore) return;
    const ttlSeconds = Math.ceil(BRIDGE_HEARTBEAT_TIMEOUT_MS / 1000);

    if (session.status === 'detected') {
      await this.stateStore.setKeyWithTTL(BRIDGE_PROBE_KEY, JSON.stringify(session), ttlSeconds);
    } else {
      await this.stateStore.setKeyWithTTL(
        `${BRIDGE_SESSION_PREFIX}${userId}`,
        JSON.stringify(session),
        ttlSeconds,
      );
    }
  }

  async removeSession(userId: string): Promise<void> {
    if (!this.stateStore) return;
    await this.stateStore.deleteKey(`${BRIDGE_SESSION_PREFIX}${userId}`);
  }

  async removeProbe(): Promise<void> {
    if (!this.stateStore) return;
    await this.stateStore.deleteKey(BRIDGE_PROBE_KEY);
  }

  /**
   * Get the bridge status for a user.
   * Checks authenticated sessions first, then falls back to probe sessions.
   */
  async getStatus(userId: string): Promise<BridgeStatusResponse> {
    const session = await this.getSession(userId);
    if (session && session.status === 'connected') {
      const isStale = Date.now() - session.lastPingAt > BRIDGE_HEARTBEAT_TIMEOUT_MS;
      if (isStale) {
        await this.removeSession(userId);
      } else {
        return {
          connected: true,
          detected: true,
          session,
          figmaDesktopReachable: session.figmaDesktopReachable,
        };
      }
    }

    const probeSession = await this.findAnyProbe();
    if (probeSession) {
      const isStale = Date.now() - probeSession.lastPingAt > BRIDGE_HEARTBEAT_TIMEOUT_MS;
      if (!isStale) {
        return {
          connected: false,
          detected: true,
          session: probeSession,
        };
      }
    }

    return { connected: false, detected: false };
  }

  async getProbeSession(): Promise<BridgeSession | null> {
    return this.findAnyProbe();
  }

  async updateProbeSession(session: BridgeSession): Promise<void> {
    if (!this.stateStore) return;
    const ttlSeconds = Math.ceil(BRIDGE_HEARTBEAT_TIMEOUT_MS / 1000);
    await this.stateStore.setKeyWithTTL(BRIDGE_PROBE_KEY, JSON.stringify(session), ttlSeconds);
  }

  private async findAnyProbe(): Promise<BridgeSession | null> {
    if (!this.stateStore) return null;
    try {
      const raw = await this.stateStore.getKey(BRIDGE_PROBE_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as BridgeSession;
    } catch {
      return null;
    }
  }
}
