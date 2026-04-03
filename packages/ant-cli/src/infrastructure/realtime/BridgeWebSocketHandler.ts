/**
 * Bridge WebSocket Handler
 *
 * Accepts WebSocket connections from Ant Desktop at /bridge/ws.
 * Manages session lifecycle (register/heartbeat/disconnect) via Redis,
 * and relays MCP requests between Job Workers and Ant Desktop
 * using user-scoped Redis Pub/Sub channels.
 *
 * Cloud-safe: each Realtime Pod only subscribes to channels for its
 * locally connected desktops. Workers publish to user-scoped channels,
 * so only the correct Pod receives the message.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import type {
  BridgeMessage,
  BridgeRegisterMessage,
  BridgeHeartbeatMessage,
  BridgeSession,
  BridgeSessionStatus,
} from '@ant/shared';
import { BRIDGE_WS_PATH, BRIDGE_WS_MAX_MESSAGE_BYTES } from '@ant/shared';
import { BridgeSessionManager } from './BridgeSessionManager';
import { createJwtServiceFromEnv, JwtService } from '../auth/JwtService';
import { getRealtimeBroadcastChannel } from '../state/redisConstants';
import { logger } from '../../utils/logger';

const COMPONENT = 'BridgeWS';

/** Per-connection context stored alongside each WebSocket. */
interface BridgeClient {
  ws: WebSocket;
  /** null until register message is processed */
  userId: string | null;
  /** Organization ID for SSE broadcast scoping. local mode → 'local', cloud → JWT org */
  orgId: string | null;
  machineId: string | null;
  /**
   * 'detected' = WS connected but no JWT (probe only)
   * 'connected' = WS connected with valid JWT (full MCP relay)
   */
  authStatus: BridgeSessionStatus;
  unsubscribeMcp: (() => void) | null;
  unsubscribeProbe: (() => void) | null;
}

export interface BridgeWebSocketHandlerDeps {
  stateStore: any;
}

export class BridgeWebSocketHandler {
  private wss: WebSocketServer;
  private sessionManager: BridgeSessionManager;
  private jwtService: JwtService | undefined;
  private stateStore: any;
  private clients = new Set<BridgeClient>();

  constructor(deps: BridgeWebSocketHandlerDeps) {
    this.stateStore = deps.stateStore;
    this.sessionManager = new BridgeSessionManager(deps.stateStore);
    this.jwtService = createJwtServiceFromEnv();

    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: BRIDGE_WS_MAX_MESSAGE_BYTES,
    });

    this.wss.on('connection', (ws: WebSocket, _req: IncomingMessage, client: BridgeClient) => {
      this.handleConnection(ws, client);
    });
  }

  /**
   * Handle HTTP upgrade for /bridge/ws path.
   * Called from RealtimeServer's upgrade event.
   *
   * Accepts both authenticated and unauthenticated connections:
   * - Authenticated (Bearer JWT) → status 'connected', full MCP relay
   * - Unauthenticated (no/bad JWT) → status 'detected', probe-only
   */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname !== BRIDGE_WS_PATH) {
      return;
    }

    const authResult = this.authenticate(req);

    const client: BridgeClient = {
      ws: null as any,
      userId: authResult.userId,
      orgId: authResult.orgId,
      machineId: null,
      authStatus: authResult.status,
      unsubscribeMcp: null,
      unsubscribeProbe: null,
    };

    this.wss.handleUpgrade(req, socket, head, (ws) => {
      client.ws = ws;
      this.clients.add(client);
      this.wss.emit('connection', ws, req, client);
    });
  }

  /** Check if this handler should handle the given upgrade request. */
  shouldHandle(req: IncomingMessage): boolean {
    const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
    return url.pathname === BRIDGE_WS_PATH;
  }

  // ─── Connection lifecycle ───────────────────────────────

  private handleConnection(ws: WebSocket, client: BridgeClient): void {
    logger.info(`Ant Desktop connected (userId=${client.userId}, auth=${client.authStatus})`, { component: COMPONENT });

    ws.on('message', (data) => {
      try {
        const msg: BridgeMessage = JSON.parse(data.toString());
        this.handleMessage(client, msg);
      } catch (err) {
        logger.warn('Failed to parse bridge message', { component: COMPONENT });
      }
    });

    ws.on('close', () => this.cleanup(client));
    ws.on('error', (err) => {
      logger.warn(`Bridge WS error: ${err.message}`, { component: COMPONENT });
      this.cleanup(client);
    });
  }

  private async handleMessage(client: BridgeClient, msg: BridgeMessage): Promise<void> {
    switch (msg.type) {
      case 'bridge.register':
        await this.handleRegister(client, msg as BridgeRegisterMessage);
        break;
      case 'bridge.heartbeat':
        await this.handleHeartbeat(client, msg as BridgeHeartbeatMessage);
        break;
      case 'bridge.disconnect':
        await this.cleanup(client);
        client.ws.close();
        break;
      case 'mcp.response':
        if (client.authStatus === 'connected') {
          await this.handleMcpResponse(msg);
        }
        break;
      default:
        logger.warn(`Unknown bridge message type: ${(msg as any).type}`, { component: COMPONENT });
    }
  }

  private async handleRegister(client: BridgeClient, msg: BridgeRegisterMessage): Promise<void> {
    const userId = client.userId || msg.userId || 'anonymous';
    client.userId = userId;
    client.machineId = msg.machineId;

    const session: BridgeSession = {
      userId,
      machineId: msg.machineId,
      capabilities: msg.capabilities,
      connectedAt: Date.now(),
      lastPingAt: Date.now(),
      status: client.authStatus,
      figmaDesktopReachable: msg.figmaDesktopReachable,
    };

    await this.sessionManager.setSession(userId, session);
    logger.info(`Bridge registered: userId=${userId}, auth=${client.authStatus}, caps=${msg.capabilities.join(',')}`, { component: COMPONENT });

    if (client.authStatus === 'connected') {
      await this.subscribeMcpChannel(client, userId);
      await this.subscribeProbeChannel(client, userId);
    }

    await this.broadcastBridgeStatus(client);
  }

  private async handleHeartbeat(client: BridgeClient, msg: BridgeHeartbeatMessage): Promise<void> {
    if (!client.userId) return;

    if (client.authStatus === 'detected') {
      const probe = await this.sessionManager.getProbeSession();
      if (!probe) return;
      const prevReachable = probe.figmaDesktopReachable;
      probe.lastPingAt = Date.now();
      if (msg.figmaDesktopReachable !== undefined) {
        probe.figmaDesktopReachable = msg.figmaDesktopReachable;
      }
      await this.sessionManager.updateProbeSession(probe);
      if (msg.figmaDesktopReachable !== undefined && msg.figmaDesktopReachable !== prevReachable) {
        await this.broadcastBridgeStatus(client);
      }
      return;
    }

    const existing = await this.sessionManager.getSession(client.userId);
    if (!existing) {
      const session: BridgeSession = {
        userId: client.userId!,
        machineId: client.machineId || 'unknown',
        capabilities: [],
        connectedAt: Date.now(),
        lastPingAt: Date.now(),
        status: client.authStatus,
        figmaDesktopReachable: msg.figmaDesktopReachable ?? false,
      };
      await this.sessionManager.setSession(client.userId!, session);
      logger.warn(`Session recovered from heartbeat (userId=${client.userId})`, { component: COMPONENT });
      await this.broadcastBridgeStatus(client);
      return;
    }

    const prevReachable = existing.figmaDesktopReachable;
    existing.lastPingAt = Date.now();
    if (msg.figmaDesktopReachable !== undefined) {
      existing.figmaDesktopReachable = msg.figmaDesktopReachable;
    }
    await this.sessionManager.setSession(client.userId, existing);
    if (msg.figmaDesktopReachable !== undefined && msg.figmaDesktopReachable !== prevReachable) {
      await this.broadcastBridgeStatus(client);
    }
  }

  private async handleMcpResponse(msg: BridgeMessage): Promise<void> {
    if (msg.type !== 'mcp.response') return;
    const { requestId, result, error } = msg as any;
    if (!requestId || !this.stateStore) return;

    const responseKey = `bridge:mcp:response:${requestId}`;
    const payload = JSON.stringify(error ? { error } : { result });
    await this.stateStore.setKeyWithTTL(responseKey, payload, 60);
  }

  // ─── SSE bridge status broadcast ────────────────────────

  /** Publish bridge status to the user's SSE broadcast channel (user-level, no projectId). */
  private async broadcastBridgeStatus(client: BridgeClient): Promise<void> {
    if (!client.userId || !client.orgId || !this.stateStore) return;

    try {
      const status = await this.sessionManager.getStatus(client.userId);
      const channel = getRealtimeBroadcastChannel(client.orgId, client.userId);

      await this.stateStore.publish(channel, {
        type: 'bridge',
        data: status,
        userContext: { organizationId: client.orgId, userId: client.userId },
      });
    } catch (err: any) {
      logger.warn(`Failed to broadcast bridge status: ${err.message}`, { component: COMPONENT });
    }
  }

  // ─── MCP channel relay (Worker → Ant Desktop) ────────────

  private async subscribeMcpChannel(client: BridgeClient, userId: string): Promise<void> {
    if (!this.stateStore) return;
    if (client.unsubscribeMcp) {
      client.unsubscribeMcp();
      client.unsubscribeMcp = null;
    }

    const channel = `bridge:mcp:request:${userId}`;
    const unsubscribe = await this.stateStore.subscribe(channel, (message: any) => {
      if (client.ws.readyState !== WebSocket.OPEN) return;
      const mcpRequest: BridgeMessage = {
        type: 'mcp.request',
        requestId: message.requestId,
        tool: message.tool,
        args: message.args,
      } as any;
      client.ws.send(JSON.stringify(mcpRequest));
    });

    client.unsubscribeMcp = unsubscribe;
    logger.info(`Subscribed to MCP channel for userId=${userId}`, { component: COMPONENT });
  }

  // ─── Status probe relay (API Server → Ant Desktop) ──────

  private async subscribeProbeChannel(client: BridgeClient, userId: string): Promise<void> {
    if (!this.stateStore) return;
    if (client.unsubscribeProbe) {
      client.unsubscribeProbe();
      client.unsubscribeProbe = null;
    }

    const channel = `bridge:status:probe:${userId}`;
    const unsubscribe = await this.stateStore.subscribe(channel, () => {
      if (client.ws.readyState !== WebSocket.OPEN) return;
      client.ws.send(JSON.stringify({ type: 'bridge.statusProbe' }));
    });

    client.unsubscribeProbe = unsubscribe;
    logger.info(`Subscribed to probe channel for userId=${userId}`, { component: COMPONENT });
  }

  // ─── Auth ───────────────────────────────────────────────

  private authenticate(req: IncomingMessage): { userId: string | null; orgId: string | null; status: BridgeSessionStatus } {
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      logger.warn(`🔌 [BridgeDiag] authenticate: no Authorization header (detected)`, { component: COMPONENT });
      return { userId: null, orgId: null, status: 'detected' };
    }

    const isCloudMode = process.env.ANT_SERVER_MODE === 'cloud';
    const token = authHeader.slice(7);

    if (!isCloudMode) {
      logger.info(`🔌 [BridgeDiag] authenticate: local mode → connected`, { component: COMPONENT });
      return { userId: 'local', orgId: 'local', status: 'connected' };
    }

    if (!this.jwtService) {
      logger.warn(`🔌 [BridgeDiag] authenticate: no JwtService in cloud mode (ANT_JWT_SECRET missing?) → detected`, { component: COMPONENT });
      return { userId: null, orgId: null, status: 'detected' };
    }

    try {
      const payload = this.jwtService.verify(token);
      logger.info(`🔌 [BridgeDiag] authenticate: JWT verified → userId=${payload.sub}, org=${payload.org}`, { component: COMPONENT });
      return { userId: payload.sub, orgId: payload.org, status: 'connected' };
    } catch (err: any) {
      logger.warn(`🔌 [BridgeDiag] authenticate: JWT verify failed — ${err.message}`, { component: COMPONENT });
      return { userId: null, orgId: null, status: 'detected' };
    }
  }

  // ─── Cleanup ────────────────────────────────────────────

  private cleaned = new WeakSet<BridgeClient>();

  private async cleanup(client: BridgeClient): Promise<void> {
    if (this.cleaned.has(client)) return;
    this.cleaned.add(client);

    if (client.unsubscribeMcp) {
      client.unsubscribeMcp();
      client.unsubscribeMcp = null;
    }
    if (client.unsubscribeProbe) {
      client.unsubscribeProbe();
      client.unsubscribeProbe = null;
    }

    if (client.userId) {
      if (client.authStatus === 'detected') {
        await this.sessionManager.removeProbe();
      } else {
        await this.sessionManager.removeSession(client.userId);
      }
      logger.info(`Bridge disconnected: userId=${client.userId}`, { component: COMPONENT });
      await this.broadcastBridgeStatus(client);
    }

    this.clients.delete(client);
  }

  /** Shut down all connections. */
  async close(): Promise<void> {
    for (const client of this.clients) {
      await this.cleanup(client);
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.close();
      }
    }
    this.wss.close();
  }
}
