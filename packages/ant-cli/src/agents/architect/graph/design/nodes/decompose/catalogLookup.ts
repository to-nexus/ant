/**
 * Catalog Lookup — Single Source of Truth
 *
 * Maps `targetFile` prefixes (`fe-system-`, `be-system-`, `api-contract-`) to
 * their catalog template files and provides utilities to:
 *
 * 1. Resolve which catalog applies to a given `targetFile`
 * 2. Load the catalog's section names
 * 3. Validate `assignedSections` against the catalog
 *
 * Consumed by:
 * - `systemDesignDecompose.validateAndFixTargetFiles` (Step 2.5 — validates
 *   that decompose's `assignedSections` belong to the correct catalog before
 *   the task hits execute).
 * - `intent/system.ts.buildSectionScope` / `buildFilteredCatalog`
 *   (execute-side rendering).
 *
 * Both consumers MUST share the same `CATALOG_MAP` and `parseCatalogSections`
 * implementation; otherwise validation and prompt rendering can diverge and
 * mask the same class of bugs we're guarding against.
 */

/**
 * Catalog file mapping by `targetFile` prefix.
 * - `names`: catalog-names file (one section per line, used for ASSIGNED /
 *   FORBIDDEN scope and validation)
 * - `full`: detailed per-section writing guide (used for filteredCatalog)
 */
export const CATALOG_MAP: Record<string, { names: string; full: string }> = {
  'fe-system-': {
    names: 'jobs/design/base/catalogs/frontend-catalog-names.md',
    full: 'jobs/design/base/catalogs/frontend-catalog.md',
  },
  'be-system-': {
    names: 'jobs/design/base/catalogs/backend-catalog-names.md',
    full: 'jobs/design/base/catalogs/backend-catalog.md',
  },
  'api-contract-': {
    names: 'jobs/design/base/catalogs/api-contract-catalog-names.md',
    full: 'jobs/design/base/catalogs/api-contract-catalog.md',
  },
};

/**
 * Resolve the catalog entry for a given `targetFile`. Returns `undefined`
 * when the filename does not match any known prefix (caller decides whether
 * to treat that as a soft-skip or hard error).
 */
export function resolveCatalogEntry(
  targetFile: string,
): { prefix: string; names: string; full: string } | undefined {
  for (const [prefix, entry] of Object.entries(CATALOG_MAP)) {
    if (targetFile.startsWith(prefix)) {
      return { prefix, names: entry.names, full: entry.full };
    }
  }
  return undefined;
}

/**
 * Parse catalog-names.md content into an array of section names.
 *
 * Format (per line): `- § Section Name` or `- § Section Name (conditional: ...)`.
 * The `(conditional: ...)` suffix is stripped so callers compare against the
 * canonical name only.
 */
export function parseCatalogSections(content: string): string[] {
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('- §'))
    .map(line => {
      const match = line.match(/^- (§ [^(]+)/);
      return match ? match[1].trim() : '';
    })
    .filter(Boolean);
}

/**
 * Resolve the templates directory, compatible with both ESM dev (tsx) and
 * bundled (esbuild) environments.
 *
 * - Dev: `import.meta.url` → `src/agents/architect/.../catalogLookup.ts` →
 *   `../../../../../../core/prompt/templates`
 * - Prod: `import.meta.url` → `dist/composition/job-runner.js` →
 *   `../core/prompt/templates` (via `/dist/` marker)
 */
export async function resolveTemplateDir(): Promise<string> {
  const { fileURLToPath } = await import('url');
  const pathModule = await import('path');

  const currentDir = pathModule.dirname(fileURLToPath(import.meta.url));

  const distMarker = `${pathModule.sep}dist${pathModule.sep}`;
  const distIdx = currentDir.lastIndexOf(distMarker);
  if (distIdx !== -1) {
    const distRoot = currentDir.substring(0, distIdx + distMarker.length - 1);
    return pathModule.join(distRoot, 'core', 'prompt', 'templates');
  }

  // src/agents/architect/graph/design/nodes/decompose/catalogLookup.ts
  // → src/core/prompt/templates  (../../../../../../core/prompt/templates)
  return pathModule.resolve(currentDir, '../../../../../../core/prompt/templates');
}

/**
 * Load and parse catalog-names section list for a given `targetFile`.
 * Returns `undefined` when the prefix is unknown or the file fails to load —
 * callers MUST treat that as "validation skipped, not violated".
 */
export async function loadCatalogSections(
  targetFile: string,
): Promise<string[] | undefined> {
  const entry = resolveCatalogEntry(targetFile);
  if (!entry) return undefined;

  try {
    const pathModule = await import('path');
    const fsModule = await import('fs/promises');
    const templateDir = await resolveTemplateDir();
    const catalogPath = pathModule.join(templateDir, entry.names);
    const content = await fsModule.readFile(catalogPath, 'utf-8');
    return parseCatalogSections(content);
  } catch (error) {
    console.warn(`⚠️  [CatalogLookup] Failed to load catalog-names: ${entry.names}`, error);
    return undefined;
  }
}

/**
 * Compute the subset of `assignedSections` that are NOT present in the
 * catalog corresponding to `targetFile`. An empty result means the
 * assignment is fully valid; a non-empty result enumerates the offending
 * sections so error messages can name them precisely.
 *
 * Behavior:
 * - Unknown `targetFile` prefix or catalog load failure → returns `[]`
 *   (validation skipped; caller already warned via `loadCatalogSections`).
 * - Empty `assignedSections` → returns `[]` (caller decides whether the
 *   absence itself is an error elsewhere).
 */
export async function assignedNotInCatalog(
  targetFile: string,
  assignedSections: string[],
): Promise<string[]> {
  if (!assignedSections || assignedSections.length === 0) return [];

  const catalogSections = await loadCatalogSections(targetFile);
  if (!catalogSections) return [];

  const catalogSet = new Set(catalogSections);
  return assignedSections.filter(s => !catalogSet.has(s));
}

/**
 * Synchronous variant of {@link assignedNotInCatalog} for tests and
 * callers that already hold the catalog section list. Useful when
 * validating many tasks against the same target catalog without re-reading
 * the template file each time.
 */
export function assignedNotInCatalogSync(
  catalogSections: string[],
  assignedSections: string[],
): string[] {
  if (!assignedSections || assignedSections.length === 0) return [];
  const catalogSet = new Set(catalogSections);
  return assignedSections.filter(s => !catalogSet.has(s));
}
