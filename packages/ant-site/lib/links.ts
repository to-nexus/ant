export const GITHUB_REPO = 'to-nexus/ant';
export const GITHUB_URL = `https://github.com/${GITHUB_REPO}`;
export const GITHUB_DISCUSSIONS_URL = `${GITHUB_URL}/discussions`;
export const GITHUB_ISSUES_URL = `${GITHUB_URL}/issues`;
export const GITHUB_GOOD_FIRST_ISSUES_URL = `${GITHUB_URL}/issues?q=is%3Aopen+label%3A%22good+first+issue%22`;
export const GITHUB_RELEASES_URL = `${GITHUB_URL}/releases`;
export const GITHUB_LICENSE_URL = `${GITHUB_URL}/blob/main/LICENSE`;
export const GITHUB_CONTRIBUTING_URL = `${GITHUB_URL}/blob/main/CONTRIBUTING.md`;
export const GITHUB_CODE_OF_CONDUCT_URL = `${GITHUB_URL}/blob/main/CODE_OF_CONDUCT.md`;
export const GITHUB_SECURITY_URL = `${GITHUB_URL}/blob/main/SECURITY.md`;
export const GITHUB_ROADMAP_URL = `${GITHUB_URL}/blob/main/docs/ROADMAP.md`;

export const DOCS_URL = `${GITHUB_URL}/tree/main/docs`;

// Ant Desktop is the Figma-bridge companion app — a SEPARATE repo from `to-nexus/ant`.
// Repo is private + releases are drafts until the OSS launch; these URLs are correct
// but will 404 for the public until then. Bump ANT_DESKTOP_VERSION per release.
export const ANT_DESKTOP_REPO = 'to-nexus/ant-desktop';
export const ANT_DESKTOP_RELEASES_URL = `https://github.com/${ANT_DESKTOP_REPO}/releases`;
export const ANT_DESKTOP_VERSION = '0.1.2';
// Tag is `v${version}`; asset filenames use the bare version.
const antDesktopAsset = (file: string) =>
  `https://github.com/${ANT_DESKTOP_REPO}/releases/download/v${ANT_DESKTOP_VERSION}/${file}`;
export const ANT_DESKTOP_MAC_ARM = antDesktopAsset(`ant-desktop_${ANT_DESKTOP_VERSION}_aarch64.dmg`);
export const ANT_DESKTOP_MAC_INTEL = antDesktopAsset(`ant-desktop_${ANT_DESKTOP_VERSION}_x86_64.dmg`);

export const LICENSE_NAME = 'Apache-2.0';
export const ORG_NAME = 'NEXUS';
