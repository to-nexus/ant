#!/usr/bin/env node
/**
 * One-shot cutover migration — legacy per-user / domain orgs → shared `individual`.
 *
 *   pnpm tsx scripts/migrate-individual-org.ts            # dry run (default)
 *   pnpm tsx scripts/migrate-individual-org.ts --apply    # perform the migration
 *
 * Why this exists
 * ───────────────
 * The org model collapsed every cloud signup into ONE shared `individual`
 * org, and re-keyed user identity from email-local-part to the FULL email
 * (collision-free in a shared org). Pre-cutover data is therefore laid out as
 *   workspaces/{personal-<sub>|<domain>}/{username}/...
 * and must move to
 *   workspaces/individual/{email}/...
 *
 * The authoritative username→email mapping lives in the Redis user records
 * (`ant:auth:user:*`, each carrying `{ id, email, currentOrganizationId }`),
 * so this script is Redis-driven. It:
 *   1. moves each user's workspace tree to `individual/{email}`,
 *   2. re-keys the Redis user record to `id = email` + `currentOrganizationId = individual`,
 *   3. ensures the `individual` org + membership exist.
 *
 * It is idempotent and SKIPS anything already migrated. It NEVER touches
 * `workspaces/local`. Transfer / artifact / baseline caches are intentionally
 * left to expire (TTL) rather than rewritten.
 *
 * Simpler alternative (pre-launch, no real data): wipe instead of migrate —
 * delete the legacy cloud org trees + `FLUSH` the `ant:auth:*` namespace, then
 * let first login recreate `individual/{email}`. Also rotate `ANT_JWT_SECRET`
 * on cutover so stale tokens (old `sub`/`org`) are rejected and users
 * re-authenticate into the new identity.
 */

import Redis from 'ioredis';
import * as fs from 'fs';
import * as path from 'path';
import { REDIS_KEYS } from '../src/core/constants/redis';
import { WorkspacePathResolver } from '../src/core/config/WorkspacePathResolver';
import { INDIVIDUAL_ORG_ID } from '@ant/shared';

interface UserRecord {
  id: string;
  email: string;
  name?: string;
  picture?: string;
  currentOrganizationId: string | null;
  createdAt: string;
}

const APPLY = process.argv.includes('--apply');
const log = (msg: string) => console.log(`[migrate] ${msg}`);

async function main(): Promise<void> {
  const url = process.env.ANT_REDIS_URL;
  if (!url) throw new Error('ANT_REDIS_URL required');
  const redis = new Redis(url);
  const workspaces = WorkspacePathResolver.getPhysicalWorkspacesPath();
  log(`mode=${APPLY ? 'APPLY' : 'DRY-RUN'} workspaces=${workspaces}`);

  // Enumerate all user records.
  const userKeys = await redis.keys(`${REDIS_KEYS.AUTH.USER}*`);
  // Exclude the byEmail index keys, which share the `user:` prefix.
  const recordKeys = userKeys.filter((k) => !k.startsWith(REDIS_KEYS.AUTH.USER_BY_EMAIL));

  let moved = 0;
  let skipped = 0;
  const now = new Date().toISOString();

  for (const key of recordKeys) {
    const raw = await redis.get(key);
    if (!raw) continue;
    let rec: UserRecord;
    try {
      rec = JSON.parse(raw) as UserRecord;
    } catch {
      continue;
    }

    const email = rec.email?.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      log(`skip (no email): ${rec.id}`);
      skipped++;
      continue;
    }

    const oldOrg = rec.currentOrganizationId;
    if (!oldOrg || oldOrg === INDIVIDUAL_ORG_ID || oldOrg === 'local' || oldOrg === '_pending') {
      skipped++;
      continue; // already individual / local / pending
    }

    const oldUsername = email.split('@')[0];
    const oldPath = path.join(workspaces, oldOrg, oldUsername);
    const newPath = path.join(workspaces, INDIVIDUAL_ORG_ID, email);

    if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
      log(`move ${oldOrg}/${oldUsername} → ${INDIVIDUAL_ORG_ID}/${email}`);
      if (APPLY) {
        fs.mkdirSync(path.dirname(newPath), { recursive: true });
        fs.renameSync(oldPath, newPath);
      }
      moved++;
    } else {
      log(`skip move (missing/exists): ${oldPath}`);
    }

    if (APPLY) {
      // Re-key the user record to id=email + individual org.
      const newRec: UserRecord = { ...rec, id: email, currentOrganizationId: INDIVIDUAL_ORG_ID };
      await redis.set(`${REDIS_KEYS.AUTH.USER}${email}`, JSON.stringify(newRec));
      await redis.set(`${REDIS_KEYS.AUTH.USER_BY_EMAIL}${email}`, email);
      // Ensure individual org + membership.
      await redis.set(
        `${REDIS_KEYS.AUTH.ORG}${INDIVIDUAL_ORG_ID}`,
        JSON.stringify({ id: INDIVIDUAL_ORG_ID, name: 'Individual', kind: 'individual', ownerId: null, createdAt: now }),
        'NX',
      );
      await redis.sadd(REDIS_KEYS.AUTH.ORG_INDEX, INDIVIDUAL_ORG_ID);
      await redis.set(
        `${REDIS_KEYS.AUTH.MEMBERSHIP}${INDIVIDUAL_ORG_ID}:${email}`,
        JSON.stringify({ userId: email, organizationId: INDIVIDUAL_ORG_ID, role: 'member', createdAt: now }),
        'NX',
      );
      await redis.sadd(`${REDIS_KEYS.AUTH.ORG_MEMBERS}${INDIVIDUAL_ORG_ID}`, email);
      await redis.sadd(`${REDIS_KEYS.AUTH.USER_ORGS}${email}`, INDIVIDUAL_ORG_ID);
    }
  }

  log(`done — moved=${moved} skipped=${skipped} (${APPLY ? 'applied' : 'dry-run; re-run with --apply'})`);
  await redis.quit();
}

main().catch((err) => {
  console.error('[migrate] failed:', err);
  process.exit(1);
});
