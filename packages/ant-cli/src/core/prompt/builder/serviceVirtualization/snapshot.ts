import { promises as fs } from 'fs';
import * as path from 'path';
import { anyInScanRadius, parseAnnotationLine } from './connectionModel';

/**
 * Service Virtualization snapshot detector (resolve-time).
 *
 * Detects whether the workspace declares a `business` `@connection`, or is
 * greenfield (no project manifest yet). Grammar, toggle naming, and the
 * bounded scan radius are owned by `./connectionModel.ts` (the connection
 * SSOT) — this file only composes those primitives into the resolve-time
 * detection used for parity activation / diagnostics. See
 * `docs/internals/38-service-virtualization.md`.
 */

const ENV_FILES = ['.env.example', 'config.example.toml'];

// Project manifests across the stacks Ant generates. Presence of any one
// (root or monorepo member) means the workspace already holds code → NOT
// greenfield.
const MANIFEST_FILES = [
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'go.mod',
  'Cargo.toml',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'composer.json',
  'Gemfile',
];

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Does THIS directory declare a `business` `@connection`? */
async function dirHasBusinessAnnotation(dir: string): Promise<boolean> {
  for (const f of ENV_FILES) {
    let content: string;
    try {
      content = await fs.readFile(path.join(dir, f), 'utf8');
    } catch {
      continue;
    }
    for (const line of content.split(/\r?\n/)) {
      if (parseAnnotationLine(line)?.category === 'business') return true;
    }
  }
  return false;
}

/** Does THIS directory hold a recognised project manifest? */
async function dirHasManifest(dir: string): Promise<boolean> {
  for (const f of MANIFEST_FILES) {
    if (await fileExists(path.join(dir, f))) return true;
  }
  return false;
}

/**
 * Detect whether the project under `featurePath/codebase/` declares any
 * `business` `@connection` annotation. Returns `false` when `featurePath`
 * is undefined (unit tests / pre-validation).
 */
export async function detectHasBusinessConnection(
  featurePath: string | undefined,
): Promise<boolean> {
  if (!featurePath) return false;
  return anyInScanRadius(path.join(featurePath, 'codebase'), dirHasBusinessAnnotation);
}

/**
 * Detect whether the workspace is GREENFIELD — no project manifest across
 * the scan radius. Returns `false` for an undefined `featurePath`.
 */
export async function detectIsGreenfield(
  featurePath: string | undefined,
): Promise<boolean> {
  if (!featurePath) return false;
  return !(await anyInScanRadius(path.join(featurePath, 'codebase'), dirHasManifest));
}

/**
 * Build the `virtualizationSnapshot` channel value. `hasBusinessConnection`
 * = existing-project business `@connection` on disk OR greenfield. See the
 * generation-vs-runtime distinction in `docs/internals/38-service-virtualization.md`.
 */
export async function buildVirtualizationSnapshot(
  featurePath: string | undefined,
): Promise<{ hasBusinessConnection: boolean }> {
  const hasBusinessConnection =
    (await detectHasBusinessConnection(featurePath)) ||
    (await detectIsGreenfield(featurePath));
  return { hasBusinessConnection };
}
