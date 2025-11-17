#!/usr/bin/env node
import "dotenv/config";
import { ExpressServerAdapter } from "../periphery/adapters/http/ExpressServerAdapter";
import { WorkspacePathResolver } from "../infrastructure/workspace/WorkspaceResolver";
import { LocalWorkspaceResolver } from "../infrastructure/workspace/WorkspaceResolver";

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
  // Environment configuration
  const mode = (process.env.ANT_SERVER_MODE || 'local') as 'local' | 'cloud';
  const port = process.env.PORT ? parseInt(process.env.PORT) : DEFAULT_PORT;
  
  // ✅ Get physical workspaces path (centralized in WorkspacePathResolver)
  const workspacesPath = WorkspacePathResolver.getPhysicalWorkspacesPath();
  // Use correct resolver for mode
  const resolver = mode === 'cloud'
    ? new (await import('../infrastructure/workspace/WorkspaceResolver')).CloudWorkspaceResolver(workspacesPath)
    : new LocalWorkspaceResolver(workspacesPath);
  
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
