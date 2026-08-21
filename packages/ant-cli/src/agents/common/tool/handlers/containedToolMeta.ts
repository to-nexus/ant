/**
 * Contained metadata for agent tool handlers (M-NEW-024).
 *
 * The tool handlers resolved a path through the port's traversal check and then
 * re-opened the same NAME with `sniffFile(...)` / `fs.statSync(...)` to get a
 * binary verdict and a size. A tenant preview child that reparents an
 * intermediate directory between the resolve and that reopen redirects the
 * metadata read to another tenant's file. These helpers bind the sniff/stat to
 * the descended base descriptor instead; a path outside the multi-tenant base
 * (`repoType:'local'`) falls back to the raw read (single-developer boundary).
 */

import * as fs from 'fs';

import { WorkspacePathResolver } from '../../../../core/config/WorkspacePathResolver';
import { toBaseRelative, sniffContainedBase, statContainedBase } from '../../../../core/config/containedIo';
import { sniffFile } from '../../../../core/utils/binaryExtensions';

/** Binary verdict + size, bound to a descended descriptor when in-base. */
export function sniffToolFile(absPath: string): { binary: boolean; size?: number } {
  const br = toBaseRelative(WorkspacePathResolver.getPhysicalWorkspacesPath(), absPath);
  if (br) {
    const res = sniffContainedBase(br);
    if (res.ok) return { binary: res.binary, size: res.size };
    // descent failed (swap / missing): fail closed to "not readable as text",
    // never returning a size derived from a raw reopen.
    return { binary: false };
  }
  return sniffFile(absPath);
}

/** File size, bound to a descended descriptor when in-base; undefined on failure. */
export function statToolFileSize(absPath: string): number | undefined {
  const br = toBaseRelative(WorkspacePathResolver.getPhysicalWorkspacesPath(), absPath);
  if (br) {
    const st = statContainedBase(br);
    return st.ok ? Number(st.stat.size) : undefined;
  }
  try {
    return fs.statSync(absPath).size;
  } catch {
    return undefined;
  }
}
