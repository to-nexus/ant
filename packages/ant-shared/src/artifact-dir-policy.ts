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
    // Images are not processed here — use inputs/references/ for design reference images.
    // Must stay in sync with ArtifactService.getSource()'s textExtensions list.
    acceptedExtensions: ['.md', '.txt', '.json', '.yaml', '.yml', '.html', '.xml', '.csv'],
  },
  'inputs/assets': {
    allowSubdirs: true,
    acceptedExtensions: ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico'],
  },
  'inputs/references': {
    allowSubdirs: false,
    acceptedExtensions: ['.png', '.jpg', '.jpeg', '.webp', '.gif'],
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
