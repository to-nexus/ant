/**
 * Universal job process-local runtime — MCP connections + tool registry +
 * the sandboxed filesystem facade.
 *
 * A job-runner child runs exactly one job, so these are process singletons
 * (derived from the active custom-job definition; workspace disk is the SSOT).
 */

import type { FileSystemPort } from '../../../core/ports/filesystem';
import { McpConnectionManager } from '../../../core/customAgents/McpConnectionManager';
import { DEFINITION_MOUNT_PREFIX } from '../../../core/customAgents/promptBlock';
import { ToolRegistry } from '../../common/tool/registry';
import { createUniversalToolRegistry } from '../../common/tool/presets';
import type { ToolName } from '../../common/tool/toolCatalog';

// The mount prefix SSOT lives in core (promptBlock.ts) so the settings API
// can render TOC paths without importing the graph; re-exported for the
// existing graph-side consumers.
export { DEFINITION_MOUNT_PREFIX };

let _mcp: McpConnectionManager | null = null;
let _registry: ToolRegistry | null = null;

export function setUniversalMcp(mcp: McpConnectionManager | null): void {
  _mcp = mcp;
}

export function getUniversalMcp(): McpConnectionManager | null {
  return _mcp;
}

/**
 * Registry singleton: universal preset + one dispatch handler per connected
 * MCP tool. Built after MCP connect (runner start).
 */
export function buildUniversalRegistry(mcp: McpConnectionManager | null): ToolRegistry {
  const registry = createUniversalToolRegistry();
  if (mcp) {
    for (const info of mcp.listToolInfos()) {
      // MCP names are dynamic — the registry map is string-keyed at runtime.
      registry.register(info.name as ToolName, async (_ctx, args) => {
        const result = await mcp.callTool(info.name, args as Record<string, unknown>);
        return {
          content: result.text || '(empty MCP result)',
          error: result.isError ? (result.text || 'MCP tool returned an error') : undefined,
        };
      });
    }
  }
  _registry = registry;
  return registry;
}

export function getUniversalRegistry(): ToolRegistry {
  if (!_registry) {
    _registry = createUniversalToolRegistry();
  }
  return _registry;
}

export function _resetUniversalRuntimeForTests(): void {
  _mcp = null;
  _registry = null;
}

/**
 * Two-root sandbox facade: `universal/artifacts/` read-write, plus the custom
 * agent definition dir mounted read-only at {@link DEFINITION_MOUNT_PREFIX}.
 * Everything else delegates verbatim to the artifacts adapter (whose
 * `resolveAbsolute` supplies path-traversal protection for both roots).
 */
export function createUniversalFileSystem(
  artifactsFs: FileSystemPort,
  definitionFs: FileSystemPort,
): FileSystemPort {
  const strip = (p: string): string => p.slice(DEFINITION_MOUNT_PREFIX.length);
  const isMounted = (p: string): boolean => p.startsWith(DEFINITION_MOUNT_PREFIX);
  const readOnly = (op: string): never => {
    throw new Error(`${op}: the agent definition mount (${DEFINITION_MOUNT_PREFIX}) is read-only`);
  };

  return {
    readFile: (p) => (isMounted(p) ? definitionFs.readFile(strip(p)) : artifactsFs.readFile(p)),
    fileExists: (p) => (isMounted(p) ? definitionFs.fileExists(strip(p)) : artifactsFs.fileExists(p)),
    readDirectory: (p) => (isMounted(p) ? definitionFs.readDirectory(strip(p)) : artifactsFs.readDirectory(p)),
    listFiles: (p, exclude) => (isMounted(p) ? definitionFs.listFiles(strip(p), exclude) : artifactsFs.listFiles(p, exclude)),
    isDirectory: (p) => (isMounted(p) ? definitionFs.isDirectory(strip(p)) : artifactsFs.isDirectory(p)),
    writeFile: (p, c) => (isMounted(p) ? readOnly('writeFile') : artifactsFs.writeFile(p, c)),
    deleteFile: (p) => (isMounted(p) ? readOnly('deleteFile') : artifactsFs.deleteFile(p)),
    createDirectory: (p) => (isMounted(p) ? readOnly('createDirectory') : artifactsFs.createDirectory(p)),
    copyFile: (src, dest, overwrite) =>
      isMounted(src) || isMounted(dest) ? readOnly('copyFile') : artifactsFs.copyFile(src, dest, overwrite),
    moveFile: (src, dest, overwrite) =>
      isMounted(src) || isMounted(dest) ? readOnly('moveFile') : artifactsFs.moveFile(src, dest, overwrite),
    copyDirectory: (src, dest) =>
      isMounted(src) || isMounted(dest) ? readOnly('copyDirectory') : artifactsFs.copyDirectory(src, dest),
    moveDirectory: (src, dest) =>
      isMounted(src) || isMounted(dest) ? readOnly('moveDirectory') : artifactsFs.moveDirectory(src, dest),
    getRootPath: () => artifactsFs.getRootPath(),
    resolveAbsolute: (p) => (isMounted(p) ? definitionFs.resolveAbsolute(strip(p)) : artifactsFs.resolveAbsolute(p)),
  };
}
