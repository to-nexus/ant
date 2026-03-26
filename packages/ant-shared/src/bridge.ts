/**
 * Bridge Protocol & Ant Desktop Types
 * 
 * Shared types for the Ant Desktop bridge communication.
 * Ant Desktop is a general-purpose local machine bridge
 * that proxies requests between the cloud agent and local resources.
 * 
 * Current capabilities: figma-mcp
 * Future: local-ide, local-fs, etc.
 * 
 * Used by ant-cli (cloud), ant-ui (frontend), and ant-desktop (desktop app).
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Constants
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const BRIDGE_WS_PATH = '/bridge/ws';
export const BRIDGE_HEARTBEAT_INTERVAL_MS = 30_000;
export const BRIDGE_HEARTBEAT_TIMEOUT_MS = 90_000;
export const BRIDGE_MCP_REQUEST_TIMEOUT_MS = 30_000;
export const BRIDGE_WS_MAX_MESSAGE_BYTES = 16_777_216;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Capabilities
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type BridgeCapability = 'figma-mcp';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// WebSocket Protocol Messages
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type BridgeMessage =
  | BridgeRegisterMessage
  | BridgeHeartbeatMessage
  | BridgeDisconnectMessage
  | MCPRequestMessage
  | MCPResponseMessage;

export interface BridgeRegisterMessage {
  type: 'bridge.register';
  userId: string;
  machineId: string;
  capabilities: BridgeCapability[];
  figmaDesktopReachable: boolean;
}

export interface BridgeHeartbeatMessage {
  type: 'bridge.heartbeat';
  timestamp: number;
  figmaDesktopReachable?: boolean;
}

export interface BridgeDisconnectMessage {
  type: 'bridge.disconnect';
  reason?: string;
}

export interface MCPRequestMessage {
  type: 'mcp.request';
  requestId: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface MCPResponseMessage {
  type: 'mcp.response';
  requestId: string;
  result?: unknown;
  error?: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Session State
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Bridge session status (server-side Redis):
 * - detected: WS connected, no JWT (probe only — app is running but not linked)
 * - connected: WS connected + JWT verified (full MCP relay active)
 * - disconnected: was connected but WS dropped (network/server failure)
 *
 * Note: "disconnected" is NOT stored in Redis (session is deleted on close).
 * It exists for Ant Desktop UI to display "연결 끊김" to the user.
 */
export type BridgeSessionStatus = 'detected' | 'connected' | 'disconnected';

export interface BridgeSession {
  userId: string;
  machineId: string;
  capabilities: BridgeCapability[];
  connectedAt: number;
  lastPingAt: number;
  status: BridgeSessionStatus;
  figmaDesktopReachable?: boolean;
}

export interface BridgeStatusResponse {
  /** Fully authenticated and connected */
  connected: boolean;
  /** App is running (WS connected) but may not be authenticated yet */
  detected: boolean;
  session?: BridgeSession;
  figmaDesktopReachable?: boolean;
}
