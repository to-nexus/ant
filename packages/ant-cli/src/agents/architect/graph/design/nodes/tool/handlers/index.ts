/**
 * Design-specific tool handlers (ctx-pure).
 *
 * Common fs handlers (`read_file`, `list_files`, `search_code`,
 * `delete_file`, `edit_file`, `create_file`, `mkdir`, …) come from
 * `agents/common/tool/handlers/` via `JOB_TOOL_MATRIX[DESIGN]` →
 * `createDesignToolRegistry()`. Only handlers below are design-only and
 * registered explicitly by `createDesignToolHandlers()`.
 */

export { handleReadSourceDoc } from './sourceDoc';
export { handleDownloadAsset, handleListAssets, pickAssetsRoot } from './assets';
export type { AssetsRootInput } from './assets';
export { handleAppendFile } from './hallucinatedAppend';
