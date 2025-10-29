#!/usr/bin/env node
import "dotenv/config";
import { program } from "./cli/command";

/**
 * Entry Point
 * 
 * Modern CLI using Commander.js
 * Supports structured commands: aidev <agent> <task> [options] <input>
 */

// ✅ Disable stdout buffering for real-time streaming output
if (process.stdout.isTTY) {
  process.stdout.setDefaultEncoding('utf8');
  // @ts-ignore - Node.js internal property
  process.stdout._handle?.setBlocking?.(true);
}

program.parse(process.argv);
