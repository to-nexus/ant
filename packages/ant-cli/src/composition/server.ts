#!/usr/bin/env node
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// ✅ CRITICAL: Load .env from packages/ant-cli directory (not project root)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, "../../.env");
dotenv.config({ path: envPath });
console.log(`[Server] Loading .env from: ${envPath}`);

import { ExpressServerAdapter } from "../periphery/adapters/http/ExpressServerAdapter";
import { WorkspacePathResolver } from "../infrastructure/workspace/WorkspaceResolver";
import { WorkspaceService } from "../infrastructure/workspace/WorkspaceService";

/**
 * Server Entry Point
 *
 * Hexagonal Architecture - Composition Root
 *
 * Supports Local and Cloud modes via configuration:
 * - Local Mode: workspaces/local/<project>
 * - Cloud Mode: workspaces/<org>/<user>/<project>
 *
 * Environment Variables:
 * - ANT_SERVER_MODE: 'local' (default) or 'cloud'
 * - ANT_CLI_PORT: Ant CLI server port (default: 4100)
 * - ANT_WORKSPACE_BASE_PATH: Physical workspace storage path (for separation from ant source)
 * - CLOUD_URL: Cloud service URL (for redirect)
 */

const DEFAULT_PORT = 4100;
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
  console.log(`  RECURSION_LIMIT: ${process.env.RECURSION_LIMIT || 'NOT SET'}`);
  
  // Environment configuration
  const mode = (process.env.ANT_SERVER_MODE || 'local') as 'local' | 'cloud';
  
  // ✅ ONLY use ANT_CLI_PORT (NEVER use PORT to avoid collision with user projects)
  const port = process.env.ANT_CLI_PORT ? parseInt(process.env.ANT_CLI_PORT) : DEFAULT_PORT;
  
  // 🚨 CRITICAL: Unset PORT to prevent child processes from inheriting it
  // User projects should use their own PORT, not ant-cli's port
  delete process.env.PORT;
  
  // ✅ Get physical workspaces path (centralized in WorkspacePathResolver)
  const workspacesPath = WorkspacePathResolver.getPhysicalWorkspacesPath();
  
  // ✅ Initialize WorkspaceService for multi-tenant workspace management
  const workspaceService = new WorkspaceService(workspacesPath);
  
  const cloudUrl = process.env.CLOUD_URL || DEFAULT_CLOUD_URL;
  
  console.log(`\n${mode === 'cloud' ? '🌐' : '💻'} Starting in ${mode.toUpperCase()} mode`);
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
  
  // Create server with mode configuration and WorkspaceService
  const server = new ExpressServerAdapter(mode, workspacesPath, cloudUrl, workspaceService);
  
  try {
    // Start server
    await server.start(port);
    console.log(`\n✅ Server listening on http://localhost:${port}`);
    console.log(`📡 Ready to accept requests\n`);
    
    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n⏳ Shutting down gracefully...');
      await server.stop();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      console.log('\n⏳ Shutting down gracefully...');
      await server.stop();
      process.exit(0);
    });
  } catch (error: any) {
    console.error('❌ Failed to start server:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
