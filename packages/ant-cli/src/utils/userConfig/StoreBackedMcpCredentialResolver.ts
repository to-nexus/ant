import type { UserContext } from '../../core/types/user';
import type { McpCredentialResolver } from '../../core/customAgents/McpCredentialResolver';
import type { CredentialsStore } from './CredentialsStore';

/**
 * The store-backed (and only) McpCredentialResolver: encrypted per-user
 * credentials.json, MCP bucket. No process.env fallback — see the port's
 * doc comment for why that door stays closed.
 */
export class StoreBackedMcpCredentialResolver implements McpCredentialResolver {
  constructor(
    private readonly store: CredentialsStore,
    private readonly userContext: UserContext,
  ) {}

  async resolve(key: string): Promise<string | undefined> {
    return (await this.store.getMcpSecret(this.userContext, key))?.value;
  }
}
