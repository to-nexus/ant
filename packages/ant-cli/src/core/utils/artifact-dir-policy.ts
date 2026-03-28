/**
 * Artifact Directory Policy
 *
 * Defines which file types and subdirectories are allowed in each canonical
 * artifact directory. Used for both server-side validation (files.routes.ts)
 * and client-side pre-validation (ArtifactsPanel.tsx).
 *
 * Mirror: packages/ant-ui/src/shared/utils/artifact-dir-policy.ts
 * Keep both files in sync.
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
    acceptedExtensions: ['.md', '.txt', '.json', '.yaml', '.yml'],
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
    allowSubdirs: false,
    acceptedExtensions: ['.md', '.json'],
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
  'outputs/plan': {
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
