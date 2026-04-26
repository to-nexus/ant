/**
 * Artifact Directory Policy (SSOT)
 *
 * Defines which file types and subdirectories are allowed in each canonical
 * artifact directory. Consumed by both sides of the BE↔FE upload contract:
 *   - BE: packages/ant-cli/src/periphery/adapters/http/routes/files.routes.ts
 *         (server-side upload / move / zip-extract validation)
 *   - FE: packages/ant-ui/src/presentation/components/ArtifactsPanel.tsx
 *         (client-side pre-validation and `<input accept>` wiring, via
 *          packages/ant-ui/src/shared/utils/canonical-dirs.ts re-export)
 *
 * Single source of truth — do not fork this file into package-local mirrors.
 */

export type ArtifactDirPolicy = {
  /** Whether subdirectories may be created inside this directory */
  allowSubdirs: boolean;
  /** Allowed file extensions (lowercase, with leading dot). undefined = no restriction */
  acceptedExtensions?: string[];
};

export const ARTIFACT_DIR_POLICIES: Record<string, ArtifactDirPolicy> = {
  'inputs/sources': {
    allowSubdirs: false,
    // Only text-formattable files are injected into prompts.
    // Must stay in sync with ArtifactService.getSource()'s textExtensions list.
    acceptedExtensions: ['.md', '.txt', '.json', '.yaml', '.yml', '.html', '.xml', '.csv'],
  },
  // Phase 2 (D19-revised): `inputs/assets` is a CONTAINER parent for the
  // two per-domain pools (`{service,game}/`). The per-domain policies
  // below own `acceptedExtensions`; the parent stays subdir-only so the
  // file-tree can render it but no direct file is allowed at the parent
  // level. Phase 1's flat-image acceptedExtensions list moved into
  // `inputs/assets/service` (icons/images) and `inputs/assets/game`
  // (icons/images + tilemap json + Phase 4 hooks).
  'inputs/assets': {
    allowSubdirs: true,
  },
  // Phase 2 (D19-revised): per-domain assets pools.
  'inputs/assets/service': {
    allowSubdirs: true,
    // Phase 4 hook will add `.woff` / `.woff2` / `.ttf` for service fonts.
    acceptedExtensions: ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico'],
  },
  'inputs/assets/game': {
    allowSubdirs: true,
    // Phase 4 hook will add `.mp3` / `.ogg` / `.wav` / `.atlas` / `.glb` /
    // `.gltf`. `.json` is accepted now for tilemap manifests.
    acceptedExtensions: ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.json'],
  },
  'outputs/design': {
    allowSubdirs: true,
    acceptedExtensions: ['.md', '.json'],
  },
  'outputs/design/ui': {
    // Parent UI source directory — contains ant/ / figma/ / handoff/ subdirs.
    allowSubdirs: true,
  },
  'outputs/design/ui/ant': {
    allowSubdirs: false,
    acceptedExtensions: ['.json'],
  },
  'outputs/design/ui/figma': {
    allowSubdirs: false,
    acceptedExtensions: ['.json'],
  },
  'outputs/design/ui/handoff': {
    // Handoff is intentionally free-form — any filetype is accepted and
    // nested subdirectories are allowed.
    allowSubdirs: true,
  },
  // Phase 2 (D24): game-art is FLAT — game-art-tokens / game-art-assets /
  // game-art-spec land directly here, no sub-source containers.
  'outputs/design/game-art': {
    allowSubdirs: false,
    acceptedExtensions: ['.json'],
  },
  'outputs/design/system': {
    allowSubdirs: false,
    acceptedExtensions: ['.md'],
  },
  'outputs/design/spec': {
    allowSubdirs: false,
    acceptedExtensions: ['.md'],
  },
  'outputs/evals/prd': {
    allowSubdirs: false,
    acceptedExtensions: ['.md'],
  },
  'outputs/evals/ui-design': {
    allowSubdirs: false,
    acceptedExtensions: ['.md'],
  },
  'outputs/evals/system-design': {
    allowSubdirs: false,
    acceptedExtensions: ['.md'],
  },
  'outputs/evals/code': {
    allowSubdirs: false,
    acceptedExtensions: ['.md'],
  },
};

/**
 * Returns the policy for a given feature-relative directory path, or null
 * if the directory has no enforced policy.
 */
export function getArtifactDirPolicy(relativePath: string): ArtifactDirPolicy | null {
  const normalized = relativePath.replace(/\\/g, '/').replace(/\/$/, '');
  return ARTIFACT_DIR_POLICIES[normalized] ?? null;
}

/**
 * Validate a single file against the policy of its target directory.
 * Returns `{ valid: true }` when there is no policy or the file is allowed.
 */
export function validateFileForDir(
  dirPath: string,
  fileName: string,
): { valid: boolean; reason?: string; allowed?: string[] } {
  const policy = getArtifactDirPolicy(dirPath);
  if (!policy) return { valid: true };
  if (!policy.acceptedExtensions) return { valid: true };

  const dotIdx = fileName.lastIndexOf('.');
  const ext = dotIdx >= 0 ? fileName.slice(dotIdx).toLowerCase() : '';
  if (!ext || !policy.acceptedExtensions.includes(ext)) {
    return {
      valid: false,
      reason: `Extension "${ext || '(none)'}" is not allowed in ${dirPath}`,
      allowed: policy.acceptedExtensions,
    };
  }
  return { valid: true };
}
