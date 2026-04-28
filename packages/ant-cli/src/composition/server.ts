#!/usr/bin/env node
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

// ✅ CRITICAL: Load .env from packages/ant-cli directory
// ES modules: need to derive __dirname from import.meta.url
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Try multiple .env locations (handles both dev and production builds)
// Note: When built, server.mjs is at dist/server.mjs (not dist/composition/server.mjs)
const possibleEnvPaths = [
  path.resolve(__dirname, "../../.env"),           // For src/composition/server.ts -> packages/ant-cli/.env (DEV)
  path.resolve(__dirname, "../.env"),              // For dist/server.mjs -> packages/ant-cli/.env (PRODUCTION)
];

let envPath: string | undefined;
for (const candidatePath of possibleEnvPaths) {
  if (fs.existsSync(candidatePath)) {
    envPath = candidatePath;
    break;
  }
}

if (envPath) {
  dotenv.config({ path: envPath });
  console.log(`[Server] Loading .env from: ${envPath}`);
} else {
  console.log(`[Server] No .env file found. Checked paths: ${possibleEnvPaths.join(', ')}`);
}

import { ExpressServerAdapter } from "../periphery/adapters/http/express";
import { WorkspacePathResolver } from "../core/config/WorkspacePathResolver";
import { WorkspaceService } from "../infrastructure/workspace/WorkspaceService";
import { initPartials } from "../periphery/adapters/prompt/FilePromptAdapter";

/**
 * Server Entry Point
 *
 * Hexagonal Architecture - Composition Root
 *
 * Local and Cloud servers use identical architecture (Redis, BullMQ, Worker-based Preview).
 * The only difference is authentication:
 * - Local Mode: Uses local:local for tenant (no real auth)
 * - Cloud Mode: Requires explicit authentication (OAuth, etc.)
 *
 * Environment Variables:
 * - ANT_SERVER_MODE: 'local' (default) or 'cloud' - affects authentication only
 * - ANT_REDIS_URL: Redis connection URL (REQUIRED)
 * - PORT: Server port (default: 8080, set via npm scripts for local dev)
 * - ANT_WORKSPACE_BASE_PATH: Physical workspace storage path
 * - ANT_K8S_NAMESPACE: Kubernetes namespace for IDE (optional, uses Docker if not set)
 */

const DEFAULT_PORT = 8080;
const DEFAULT_CLOUD_URL = 'https://ant.nexus.ai';

async function main() {
  // ✅ Debug: Check if environment variables are loaded
  console.log('[Server] Environment variables check:');
  console.log(`  ANT_ENCRYPTION_KEY present: ${!!process.env.ANT_ENCRYPTION_KEY}`);
  if (process.env.ANT_ENCRYPTION_KEY) {
    console.log(`  ANT_ENCRYPTION_KEY length: ${process.env.ANT_ENCRYPTION_KEY.length}`);
  } else {
    console.warn('  ⚠️  ANT_ENCRYPTION_KEY not found in environment!');
  }
  // Environment configuration
  const mode = (process.env.ANT_SERVER_MODE || 'local') as 'local' | 'cloud';
  
  // Use PORT environment variable (default: 8080)
  // For local dev, ports are specified in npm scripts (PORT=4100 etc.)
  const port = parseInt(process.env.PORT || String(DEFAULT_PORT));
  
  // ✅ Get physical workspaces path (centralized in WorkspacePathResolver)
  const workspacesPath = WorkspacePathResolver.getPhysicalWorkspacesPath();

  // 단방향 원칙: 옛 I/O 트리(`inputs/`, `outputs/`)가 디스크에 잔존하면
  // stderr 안내 한 번 출력 후 break (서버는 시작) — 사용자가 옛 워크스페이스
  // 상태에서도 부팅하여 `pnpm migrate:workspace --apply` 를 실행할 수 있게 한다.
  detectLegacyWorkspaceTree(workspacesPath);

  // ✅ Initialize WorkspaceService for multi-tenant workspace management
  const workspaceService = new WorkspaceService(workspacesPath);
  
  const cloudUrl = process.env.CLOUD_URL || DEFAULT_CLOUD_URL;
  
  const startTime = new Date().toISOString();
  console.log(`\n${mode === 'cloud' ? '🌐' : '💻'} Starting in ${mode.toUpperCase()} mode`);
  console.log(`   Started: ${startTime}`);
  console.log(`   Workspaces: ${workspacesPath}`);
  if (process.env.ANT_WORKSPACE_BASE_PATH) {
    console.log(`   ✅ Physical separation enabled (custom path)`);
  } else {
    console.log(`   ⚠️  Using default workspace path (inside ant source)`);
  }
  console.log(`   Port: ${port}`);
  if (mode === 'local') {
    console.log(`   Cloud URL: ${cloudUrl}`);
  }
  
  // Register all Handlebars partials before accepting requests
  const partialResult = await initPartials();
  if (partialResult.failed.length > 0) {
    console.error(`⛔ ${partialResult.failed.length} partial(s) failed to register — server may produce incomplete prompts`);
  }

  // §5 chat SSOT migration — collapse legacy chat.jsonl files to a single
  // placeholder line on first boot. feature.jsonl is preserved (LLM
  // context survives). Idempotent via marker file.
  try {
    const { discardLegacyChatJsonl } = await import('../../scripts/discard-legacy-chat-jsonl');
    await discardLegacyChatJsonl(workspacesPath);
  } catch (err) {
    console.warn('[Server] chat.jsonl migration failed (continuing):', err);
  }

  // Create server with mode configuration and WorkspaceService
  const server = new ExpressServerAdapter(mode, workspacesPath, cloudUrl, workspaceService);
  
  try {
    await server.start(port);
    console.log(`\n✅ Server listening on http://localhost:${port}`);
    console.log(`📡 Ready to accept requests\n`);
    
    // Graceful shutdown (with duplicate call prevention)
    let isShuttingDown = false;
    
    const gracefulShutdown = async (signal: string) => {
      if (isShuttingDown) {
        console.log(`\n⚠️  Shutdown already in progress (${signal} ignored)`);
        return;
      }
      isShuttingDown = true;
      console.log(`\n⏳ Shutting down gracefully (${signal})...`);
      await server.stop();
      process.exit(0);
    };
    
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  } catch (error: any) {
    console.error('❌ Failed to start server:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

/**
 * 워크스페이스 디스크 잔존 옛 트리(`inputs/`, `outputs/`) 검출.
 * 검출 시 stderr 안내만 출력 (마이그레이션 명령) — 부팅을 막지 않는다.
 * 한 번 경고 후 즉시 break 하여 스캔 비용을 제한한다.
 */
function detectLegacyWorkspaceTree(workspacesPath: string): void {
  if (!fs.existsSync(workspacesPath)) return;
  try {
    for (const entry of fs.readdirSync(workspacesPath)) {
      const orgDir = path.join(workspacesPath, entry);
      if (!fs.statSync(orgDir).isDirectory()) continue;
      const found = scanForLegacyTree(orgDir);
      if (found) {
        console.error(
          `\n[ant] Legacy workspace layout detected at ${found}.\n` +
          `       Run: pnpm migrate:workspace --apply --workspaces-path ${workspacesPath}\n`,
        );
        break;
      }
    }
  } catch (err) {
    console.warn('[ant] legacy workspace scan failed (continuing):', err);
  }
}

function scanForLegacyTree(dir: string, depth = 0): string | null {
  if (depth > 5) return null;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name === 'inputs' || e.name === 'outputs') {
      return path.join(dir, e.name);
    }
    if (e.name === 'codebase' || e.name === 'sessions') continue;
    const sub = scanForLegacyTree(path.join(dir, e.name), depth + 1);
    if (sub) return sub;
  }
  return null;
}

main();
