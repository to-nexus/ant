/**
 * Organization-level Configuration Types
 * 
 * Org config is shared across all users within an organization.
 * Stored at: {workspaces}/{orgId}/.ant/org-config.json
 */

/**
 * GitHub integration settings for the organization
 */
export interface OrgGitHubConfig {
  /** 
   * Default GitHub owner (user or organization) for new projects.
   * When set, new projects automatically get githubRepo = https://github.com/{owner}/{projectName}
   * 
   * Examples: "to-nexus", "my-company", "harvey-probe"
   */
  owner?: string;
}

/**
 * Organization Configuration
 * 
 * Defines organization-wide defaults that apply to all projects.
 * Individual project settings can override these.
 */
export interface OrgConfig {
  /** GitHub integration defaults */
  github?: OrgGitHubConfig;
}

/**
 * Build default GitHub repo URL from org config and project name
 * @returns Full GitHub URL or undefined if no owner configured
 */
export function buildDefaultGitHubRepoUrl(orgConfig: OrgConfig | null, projectName: string): string | undefined {
  const owner = orgConfig?.github?.owner;
  if (!owner) return undefined;
  
  // Sanitize project name for URL
  const sanitized = projectName
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  
  return `https://github.com/${owner}/${sanitized}`;
}
