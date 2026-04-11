/**
 * Design Job Nodes Export
 * 
 * ✅ NEW: Tool Calling Architecture (unified with Code job)
 * - docGen: LLM reasoning (replaces execute)
 * - tool: Tool execution (immediate disk write)
 * 
 * ❌ REMOVED:
 * - execute: Replaced by docGen + tool
 * - writeFiles: Tool node writes immediately
 */

export { designResolveStrategy } from "./resolve";
export { decompose } from "./decompose/index";
export { plan } from "./plan";
export { docGen } from "./docGen/index";  // ✅ Refactored: docGen/ directory
export { tool } from "./tool";      // ✅ NEW: Tool execution
export { learn } from "./learn";

