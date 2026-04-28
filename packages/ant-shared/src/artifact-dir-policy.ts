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
  // plan — depth -1 (sources 폴더 제거, 파일 직속). prd.md / gdd.md 가 직접 위치.
  'plan': {
    allowSubdirs: false,
    // Only text-formattable files are injected into prompts.
    // Must stay in sync with ArtifactService.getSource()'s textExtensions list.
    acceptedExtensions: ['.md', '.txt', '.json', '.yaml', '.yml', '.html', '.xml', '.csv'],
  },
  // Phase 2 (D19-revised): `assets` is a CONTAINER parent for the two
  // per-domain pools (`{service,game}/`). The per-domain policies below
  // own `acceptedExtensions`; the parent stays subdir-only so the
  // file-tree can render it but no direct file is allowed at the parent
  // level. Phase 1's flat-image acceptedExtensions list moved into
  // `assets/service` (icons/images) and `assets/game` (icons/images +
  // tilemap json + Phase 4 hooks).
  'assets': {
    allowSubdirs: true,
  },
  // Phase 2 (D19-revised): per-domain assets pools.
  'assets/service': {
    allowSubdirs: true,
    // Phase 4 (D-P4): web-font formats activated for the service domain
    // so logo / brand / icon-pack fonts can ship under
    // `assets/service/fonts/`.
    acceptedExtensions: [
      '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico',
      '.woff', '.woff2', '.ttf', '.otf',
    ],
  },
  'assets/game': {
    allowSubdirs: true,
    // Phase 4 (D-P4): audio + atlas + 3D model formats activated for the
    // game domain. The game-art catalog (`game-art-assets.json`) records
    // `kind: 'external'` `src` paths into these subdirs once the relevant
    // scope marker is upgraded — `_meta.audioScope === 'external-enabled'`
    // for sfx/bgm, `_meta.visualScope === 'atlas-enabled'` for atlas.
    //   - audio (sfx / bgm): .mp3 / .ogg / .wav
    //   - sprite atlas: .json (manifest) + .png / .webp (atlas image)
    //   - 3D models (Phase 5+ hook, perspective='3d'): .glb / .gltf
    acceptedExtensions: [
      '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.json',
      '.mp3', '.ogg', '.wav',
      '.atlas',
      '.glb', '.gltf',
    ],
  },
  // architecture — system / spec 두 트랙. 부모 정책은 두지 않는다 (서브 정책으로 충분).
  'architecture/system': {
    allowSubdirs: false,
    acceptedExtensions: ['.md'],
  },
  'architecture/spec': {
    allowSubdirs: false,
    acceptedExtensions: ['.md'],
  },
  // visual — ui / game-art 두 sub-source 컨테이너. 부모 정책은 두지 않는다.
  'visual/ui': {
    // Parent UI source directory — contains ant/ / figma/ / handoff/ subdirs.
    allowSubdirs: true,
  },
  'visual/ui/ant': {
    allowSubdirs: false,
    acceptedExtensions: ['.json'],
  },
  'visual/ui/figma': {
    allowSubdirs: false,
    acceptedExtensions: ['.json'],
  },
  'visual/ui/handoff': {
    // Handoff is intentionally free-form — any filetype is accepted and
    // nested subdirectories are allowed.
    allowSubdirs: true,
  },
  // v8 (D24-revised): game-art is sub-sourced (mirrors `visual/ui/`).
  // The parent surface only allows the `ant/` / `figma/` / `handoff/` sub-
  // source containers; LLM-generated game-art-*.json files land directly
  // under `ant/` (canonical sub-source).
  'visual/game-art': {
    allowSubdirs: true,
  },
  'visual/game-art/ant': {
    allowSubdirs: false,
    acceptedExtensions: ['.json'],
  },
  // Phase 5+ hook — figma / handoff sub-sources stay parser-only until the
  // visual job activates them. The policies are pre-registered so the
  // upload contract is symmetric with `visual/ui/`.
  'visual/game-art/figma': {
    allowSubdirs: false,
    acceptedExtensions: ['.json'],
  },
  'visual/game-art/handoff': {
    // Free-form handoff (mirrors ui/handoff) — Phase 5+ activates upload.
    allowSubdirs: true,
  },
  // meta/evals — 평가 산출물 (네 슬러그: prd / ui-design / system-design / code).
  'meta/evals/prd': {
    allowSubdirs: false,
    acceptedExtensions: ['.md'],
  },
  'meta/evals/ui-design': {
    allowSubdirs: false,
    acceptedExtensions: ['.md'],
  },
  'meta/evals/system-design': {
    allowSubdirs: false,
    acceptedExtensions: ['.md'],
  },
  'meta/evals/code': {
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
