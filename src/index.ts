#!/usr/bin/env node
import "dotenv/config";
import { program } from "./cli/command";

/**
 * Entry Point
 * 
 * Modern CLI using Commander.js
 * Supports structured commands: aidev <agent> <task> [options] <input>
 */

program.parse(process.argv);
