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
// The repo is still private until the OSS launch, so these URLs 404 for anyone without
// read access — but only for that reason. The release itself MUST be published: `latest`
// resolves to the newest published, non-prerelease release, so a draft is invisible here
// no matter how recent its tag.
export const ANT_DESKTOP_REPO = 'to-nexus/ant-desktop';
export const ANT_DESKTOP_RELEASES_URL = `https://github.com/${ANT_DESKTOP_REPO}/releases`;
// `releases/latest/download/<file>` only redirects on an exact filename, and the assets
// embed the version (`ant-desktop_1.0.1_aarch64.dmg`). So the latest release is resolved
// at runtime (`useLatestDesktopRelease`) and its own asset URLs are used — no version
// constant lives on the site, and nothing has to be bumped per release.
export const ANT_DESKTOP_LATEST_API_URL = `https://api.github.com/repos/${ANT_DESKTOP_REPO}/releases/latest`;

export const LICENSE_NAME = 'Apache-2.0';
export const ORG_NAME = 'NEXUS';
