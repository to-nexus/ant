import { UserContext } from '../../../../../../core/types/user';
import { GitHubAuthService } from '../../../../auth/GitHubAuthService';

/**
 * Resolve the PAT owner's GitHub commit identity for `GitHelper.ensureUserConfig`
 * (and the anchor initial-commit env vars). Returns `undefined` when no auth
 * service is wired or no PAT is configured, so callers fall back to the
 * synthetic identity. Best-effort — never throws.
 */
export async function resolveCommitIdentity(
  githubAuthService: GitHubAuthService | undefined,
  userContext: UserContext
): Promise<{ name: string; email: string } | undefined> {
  if (!githubAuthService) return undefined;
  try {
    const identity = await githubAuthService.getCommitIdentity({
      org: userContext.organizationId,
      user: userContext.userId,
    });
    return identity ?? undefined;
  } catch {
    return undefined;
  }
}
