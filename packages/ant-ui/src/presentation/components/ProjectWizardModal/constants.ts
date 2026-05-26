const DESIGN_DOC_PATTERNS = [
  /^api-contract-.+\.md$/,
  /^fe-system-.+\.md$/,
  /^be-system-.+\.md$/,
  /^ui-tokens\.json$/,
  /^ui-assets\.json$/,
  /^ui-spec\.json$/,
];

const SPEC_PATH_RE = /(^|\/)architecture\/spec\/[^/]+\.md$/;
const LEGACY_SPEC_NAME_RE = /^spec-.+\.md$/;

export function isCanonicalDesignDoc(filenameOrPath: string): boolean {
  const filename = filenameOrPath.split('/').pop() ?? filenameOrPath;
  if (SPEC_PATH_RE.test(filenameOrPath)) return true;
  if (LEGACY_SPEC_NAME_RE.test(filename)) return true;
  return DESIGN_DOC_PATTERNS.some((p) => p.test(filename));
}

const VALID_NAME_RE = /^[a-zA-Z0-9_-]+$/;

export function isValidName(name: string): boolean {
  return VALID_NAME_RE.test(name);
}

export function sanitizeRepoName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
}

export function delay(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

export function generateProjectName(existing: string[]): string {
  let n = 1;
  while (existing.includes(`project-${n}`)) n++;
  return `project-${n}`;
}

export function generateFeatureName(existing: string[]): string {
  let n = 1;
  while (existing.includes(`ant-${n}`)) n++;
  return `ant-${n}`;
}
