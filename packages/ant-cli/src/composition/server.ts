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
import { LocalWorkspaceResolver } from "../infrastructure/workspace/LocalWorkspaceResolver";

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
 * - PORT: Server port (default: 4100)
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
  const port = process.env.PORT ? parseInt(process.env.PORT) : DEFAULT_PORT;
  
  // 🚨 CRITICAL: Set ANT_SERVER_PORT for child processes to use
  // This allows run_command safeguard to protect orchestrator port
  process.env.ANT_SERVER_PORT = port.toString();
  
  // ✅ Get physical workspaces path (centralized in WorkspacePathResolver)
  const workspacesPath = WorkspacePathResolver.getPhysicalWorkspacesPath();
  // Use correct resolver for mode
  const resolver = mode === 'cloud'
    ? new (await import('../infrastructure/workspace/WorkspaceResolver')).CloudWorkspaceResolver(workspacesPath)
    : new LocalWorkspaceResolver();
  
  const cloudUrl = process.env.CLOUD_URL || DEFAULT_CLOUD_URL;
  
  console.log(`\n${mode === 'cloud' ? '🌐' : '💻'} Starting in ${mode.toUpperCase()} mode`);
  console.log(`   Workspaces: ${workspacesPath}`);
  console.log(`   Port: ${port}`);
  if (mode === 'local') {
    console.log(`   Cloud URL: ${cloudUrl}`);
  }
  
  // Create server with mode configuration
  const server = new ExpressServerAdapter(mode, workspacesPath, cloudUrl);
  
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
