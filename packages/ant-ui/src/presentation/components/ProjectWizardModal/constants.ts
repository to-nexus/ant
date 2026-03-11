const DESIGN_DOC_PATTERNS = [
  /^api-contract-.+\.md$/,
  /^fe-system-.+\.md$/,
  /^be-system-.+\.md$/,
  /^spec-.+\.md$/,
  /^ui-tokens\.json$/,
  /^ui-assets\.json$/,
  /^ui-spec\.json$/,
];

export function isCanonicalDesignDoc(filename: string): boolean {
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
