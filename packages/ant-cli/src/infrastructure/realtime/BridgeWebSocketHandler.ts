/**
 * Bridge WebSocket Handler
 *
 * Accepts WebSocket connections from the Companion App at /bridge/ws.
 * Manages session lifecycle (register/heartbeat/disconnect) via Redis,
 * and relays MCP requests between Job Workers and the Companion App
 * using user-scoped Redis Pub/Sub channels.
 *
 * Cloud-safe: each Realtime Pod only subscribes to channels for its
 * locally connected companions. Workers publish to user-scoped channels,
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
import { logger } from '../../utils/logger';

const COMPONENT = 'BridgeWS';

/** Per-connection context stored alongside each WebSocket. */
interface BridgeClient {
  ws: WebSocket;
  /** null until register message is processed */
  userId: string | null;
  machineId: string | null;
  /**
   * 'detected' = WS connected but no JWT (probe only)
   * 'connected' = WS connected with valid JWT (full MCP relay)
   */
  authStatus: BridgeSessionStatus;
  unsubscribeMcp: (() => void) | null;
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
      machineId: null,
      authStatus: authResult.status,
      unsubscribeMcp: null,
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
    logger.info(`Companion connected (userId=${client.userId}, auth=${client.authStatus})`, { component: COMPONENT });

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
    }
  }

  private async handleHeartbeat(client: BridgeClient, msg: BridgeHeartbeatMessage): Promise<void> {
    if (!client.userId) return;

    if (client.authStatus === 'detected') {
      const probe = await this.sessionManager.getProbeSession();
      if (!probe) return;
      probe.lastPingAt = Date.now();
      if (msg.figmaDesktopReachable !== undefined) {
        probe.figmaDesktopReachable = msg.figmaDesktopReachable;
      }
      await this.sessionManager.updateProbeSession(probe);
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
      return;
    }

    existing.lastPingAt = Date.now();
    if (msg.figmaDesktopReachable !== undefined) {
      existing.figmaDesktopReachable = msg.figmaDesktopReachable;
    }
    await this.sessionManager.setSession(client.userId, existing);
  }

  private async handleMcpResponse(msg: BridgeMessage): Promise<void> {
    if (msg.type !== 'mcp.response') return;
    const { requestId, result, error } = msg as any;
    if (!requestId || !this.stateStore) return;

    const responseKey = `bridge:mcp:response:${requestId}`;
    const payload = JSON.stringify(error ? { error } : { result });
    await this.stateStore.setKeyWithTTL(responseKey, payload, 60);
  }

  // ─── MCP channel relay (Worker → Companion) ────────────

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

  // ─── Auth ───────────────────────────────────────────────

  private authenticate(req: IncomingMessage): { userId: string | null; status: BridgeSessionStatus } {
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      return { userId: null, status: 'detected' };
    }

    const isCloudMode = process.env.ANT_SERVER_MODE === 'cloud';
    const token = authHeader.slice(7);

    if (!isCloudMode) {
      return { userId: 'local', status: 'connected' };
    }

    if (!this.jwtService) {
      return { userId: null, status: 'detected' };
    }

    try {
      const payload = this.jwtService.verify(token);
      return { userId: payload.sub, status: 'connected' };
    } catch {
      return { userId: null, status: 'detected' };
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

    if (client.userId) {
      if (client.authStatus === 'detected') {
        await this.sessionManager.removeProbe();
      } else {
        await this.sessionManager.removeSession(client.userId);
      }
      logger.info(`Bridge disconnected: userId=${client.userId}`, { component: COMPONENT });
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
