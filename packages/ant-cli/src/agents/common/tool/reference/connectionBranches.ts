/**
 * Connection-aware sibling branch resolution. The service-virtualization
 * `@connection … ant-project:{project}:{feature}[:{service}]` annotations in
 * the current project's `.env.example` / `config.example.toml` already record
 * which sibling project + feature a cross-project link points at. That is the
 * authoritative answer to "which branch of the sibling should I read", so the
 * reference catalog surfaces it and register_reference defaults to it — instead
 * of the LLM blind-guessing `main` / `feature/base` / etc.
 *
 * Core layer only: reuses the `@connection` grammar SSOT + bounded scan radius
 * from `core/prompt/builder/serviceVirtualization/connectionModel.ts`, so the
 * tool layer stays decoupled from periphery/http (same rule catalog.ts follows).
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import {
  parseAnnotationLine,
  collectInScanRadius,
} from '../../../../core/prompt/builder/serviceVirtualization/connectionModel';

/** `ant-project:{project}:{feature}[:{service}]` — capture project + feature. */
const ANT_PROJECT_MODIFIER_RE = /^ant-project:([^:]+):([^:]+)(?::.+)?$/;

const ANNOTATION_FILES = ['.env.example', 'config.example.toml'];

/**
 * Map sibling project → the feature its `@connection ant-project:…` link
 * targets. `self` links (current project/feature) are skipped — they are not
 * cross-project references. First occurrence wins on duplicate project links.
 * Non-fatal: returns an empty map on any read/scan failure.
 */
export async function buildConnectionBranchMap(
  codebaseRoot: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const contents = await collectInScanRadius(codebaseRoot, async (dir) => {
      const out: string[] = [];
      for (const name of ANNOTATION_FILES) {
        try {
          out.push(await fs.readFile(path.join(dir, name), 'utf-8'));
        } catch {
          // file absent — skip
        }
      }
      return out;
    });
    for (const content of contents) {
      for (const line of content.split('\n')) {
        const ann = parseAnnotationLine(line);
        const modifier = ann?.modifier?.trim();
        if (!modifier || modifier === 'self') continue;
        const m = modifier.match(ANT_PROJECT_MODIFIER_RE);
        if (!m) continue;
        const [, project, feature] = m;
        if (!map.has(project)) map.set(project, feature);
      }
    }
  } catch {
    // scan failure — degrade to no hints
  }
  return map;
}
