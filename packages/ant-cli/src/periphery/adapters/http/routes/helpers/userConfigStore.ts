/**
 * User-config store helper (SSOT)
 *
 * Per-user configuration persisted at
 *   `{workspaces}/{orgId}/{userId}/.ant/user-config.json`.
 *
 * Extracted into its own module so both `org.routes` (read/write endpoints)
 * and `transfer.routes` (visibility gate) share one definition without a
 * circular import.
 */

import * as fs from 'fs';
import * as path from 'path';

export type AccountVisibility = 'public' | 'private';

export interface UserConfig {
  github?: {
    /** User-level override for the default GitHub owner. null = clear. */
    ownerOverride?: string | null;
  };
  /** Account-level org settings (individual orgs). */
  account?: {
    /** Discoverability in transfer search. Default `'public'` when absent. */
    visibility?: AccountVisibility;
  };
}

export function getUserConfigPath(workspacesPath: string, orgId: string, userId: string): string {
  return path.join(workspacesPath, orgId, userId, '.ant', 'user-config.json');
}

export async function readUserConfig(
  workspacesPath: string,
  orgId: string,
  userId: string,
): Promise<UserConfig> {
  try {
    const data = await fs.promises.readFile(getUserConfigPath(workspacesPath, orgId, userId), 'utf-8');
    return JSON.parse(data) as UserConfig;
  } catch {
    return {};
  }
}

export async function writeUserConfig(
  workspacesPath: string,
  orgId: string,
  userId: string,
  config: UserConfig,
): Promise<void> {
  const configPath = getUserConfigPath(workspacesPath, orgId, userId);
  await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
  await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Account visibility for a user — defaults to `'public'` (the product
 * default, and the value for brand-new users with no config file yet).
 */
export async function readUserVisibility(
  workspacesPath: string,
  orgId: string,
  userId: string,
): Promise<AccountVisibility> {
  const config = await readUserConfig(workspacesPath, orgId, userId);
  return config.account?.visibility ?? 'public';
}
