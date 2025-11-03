#!/usr/bin/env node
import "dotenv/config";
import { ExpressServerAdapter } from "../periphery/adapters/http/ExpressServerAdapter";

/**
 * Server Entry Point
 * 
 * Hexagonal Architecture - Composition Root
 * 
 * This file wires the HTTP adapter to the existing orchestrator.
 * No business logic here - just dependency injection.
 * 
 * The orchestrator remains unchanged and can still be used
 * via CLI (src/index.ts) or HTTP (this file).
 */

const DEFAULT_PORT = 3001;

async function main() {
  const port = process.env.PORT ? parseInt(process.env.PORT) : DEFAULT_PORT;
  
  // Create adapter (implements Port interfaces)
  const server = new ExpressServerAdapter();
  
  try {
    // Start server
    await server.start(port);
    
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
    process.exit(1);
  }
}

main();
