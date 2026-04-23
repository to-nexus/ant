/**
 * File Resource — BE↔FE shared contract
 *
 * A single file is modelled as one remote resource: content + meta.
 * This is the SSOT for the empty-file / template-marker detection result
 * that the editor header warning subscribes to.
 *
 * See docs/architecture/ui-async-policy.md "Remote Resource Single-SSOT".
 */

export type TemplateReason = 'file_empty' | 'marker_and_short_content';

export interface FileResourceMeta {
  size: number;
  /** Server mtime in ms since epoch. Used for SSE echo suppression. */
  mtime: number;
  isTemplate: boolean;
  templateReason: TemplateReason | null;
  /** Present when templateReason === 'marker_and_short_content'. */
  templateContentLength?: number;
  templateThreshold?: number;
}

export interface FileResource {
  projectId: string;
  featureName: string;
  path: string;
  content: string;
  meta: FileResourceMeta;
}

/**
 * File tree node. Every file node carries `meta` (size / mtime / template
 * state) in the single `FileResourceMeta` shape — the legacy flat `size` /
 * `modifiedTime` / `isTemplate` properties have been removed to keep a
 * single authority for stat data. Directory nodes have no `meta`.
 */
export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  meta?: FileResourceMeta;
}
