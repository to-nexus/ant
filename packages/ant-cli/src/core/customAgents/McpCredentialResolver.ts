/**
 * Port: resolves the credential key names that agent definitions reference in
 * `mcp.servers[].headers` / `env` values to their secret values.
 *
 * Store-only by design — there is deliberately NO process.env fallback. The
 * worker env is tenant-shared (and baked into the image in cloud), and a
 * definition author who controls both `url`/`command` and the key names could
 * otherwise exfiltrate platform secrets by naming them (e.g.
 * `headers: { X: ANTHROPIC_API_KEY }`). The only implementation reads the
 * encrypted per-user CredentialsStore.
 */
export interface McpCredentialResolver {
  /** Returns the secret value for a credential key, or undefined if unregistered. */
  resolve(key: string): Promise<string | undefined>;
}
