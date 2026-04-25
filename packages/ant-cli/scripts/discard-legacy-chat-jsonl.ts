/**
 * discard-legacy-chat-jsonl.ts
 *
 * One-shot migration that runs once on server boot to discard pre-§5
 * chat.jsonl payloads that don't satisfy the new ChatStatusLine.cardId
 * requirement. The chat SSOT refactor (`docs/...chat-ssot-unification`)
 * adopted "no legacy / no BC" — existing chat history is collapsed to a
 * single placeholder line, but `feature.jsonl` is preserved so the LLM
 * context survives.
 *
 * Idempotent: a feature that already has a single `collapsed` line of
 * `reason='schema-migration'` is left alone.
 *
 * Behavior:
 *   For each chat.jsonl under the workspaces directory:
 *     1. Skip if already collapsed (single line with `reason='schema-migration'`).
 *     2. Skip if file is empty.
 *     3. Otherwise: rewrite the file with a single line:
 *        `{ type: 'collapsed', ts, count, reason: 'schema-migration' }`.
 *   feature.jsonl is NOT touched.
 *
 * The script is intentionally chatty on stdout so the operator can see
 * how many features were migrated. Errors per file are logged and
 * skipped so a single corrupt feature does not block boot.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { WorkspacePathResolver } from '../src/core/config/WorkspacePathResolver';

interface CollapseLine {
  type: 'collapsed';
  ts: string;
  count: number;
  reason: 'schema-migration';
}

const MARKER_FILE = '.chat-jsonl-schema-migration-done';

/**
 * Walk the workspaces tree to discover every chat.jsonl.
 * Layout:
 *   workspaces/{org}/{user}/{project}/features/{feature}/chat.jsonl
 */
async function findChatJsonlFiles(workspacesRoot: string): Promise<string[]> {
  const out: string[] = [];

  async function walkOrg(orgRoot: string): Promise<void> {
    const orgEntries = await fs.readdir(orgRoot, { withFileTypes: true }).catch(() => []);
    for (const orgEntry of orgEntries) {
      if (!orgEntry.isDirectory()) continue;
      const userRoot = path.join(orgRoot, orgEntry.name);
      const userEntries = await fs.readdir(userRoot, { withFileTypes: true }).catch(() => []);
      for (const userEntry of userEntries) {
        if (!userEntry.isDirectory()) continue;
        const projectsRoot = path.join(userRoot, userEntry.name);
        const projectEntries = await fs.readdir(projectsRoot, { withFileTypes: true }).catch(() => []);
        for (const projectEntry of projectEntries) {
          if (!projectEntry.isDirectory()) continue;
          const featuresRoot = path.join(projectsRoot, projectEntry.name, 'features');
          const featureEntries = await fs.readdir(featuresRoot, { withFileTypes: true }).catch(() => []);
          for (const featureEntry of featureEntries) {
            if (!featureEntry.isDirectory()) continue;
            const chatJsonl = path.join(featuresRoot, featureEntry.name, 'chat.jsonl');
            try {
              await fs.access(chatJsonl);
              out.push(chatJsonl);
            } catch {
              // missing — fine.
            }
          }
        }
      }
    }
  }

  await walkOrg(workspacesRoot);
  return out;
}

async function isAlreadyCollapsed(file: string): Promise<boolean> {
  const content = await fs.readFile(file, 'utf-8').catch(() => '');
  if (!content.trim()) return true; // empty: nothing to migrate.
  const lines = content.split('\n').filter(Boolean);
  if (lines.length !== 1) return false;
  try {
    const parsed = JSON.parse(lines[0]);
    return parsed?.type === 'collapsed' && parsed?.reason === 'schema-migration';
  } catch {
    return false;
  }
}

async function collapse(file: string): Promise<{ collapsed: boolean; count: number }> {
  if (await isAlreadyCollapsed(file)) return { collapsed: false, count: 0 };
  const content = await fs.readFile(file, 'utf-8');
  const count = content.split('\n').filter(Boolean).length;
  if (count === 0) return { collapsed: false, count: 0 };
  const line: CollapseLine = {
    type: 'collapsed',
    ts: new Date().toISOString(),
    count,
    reason: 'schema-migration',
  };
  await fs.writeFile(file, JSON.stringify(line) + '\n', 'utf-8');
  return { collapsed: true, count };
}

/**
 * Run the migration once. Caller (server bootstrap) checks the marker
 * file at the workspaces root and only invokes this when missing.
 */
export async function discardLegacyChatJsonl(workspacesRoot?: string): Promise<{
  scanned: number;
  migrated: number;
  skipped: number;
  errors: number;
}> {
  const root = workspacesRoot ?? WorkspacePathResolver.getPhysicalWorkspacesPath();
  const marker = path.join(root, MARKER_FILE);

  // Idempotency: marker file means we already ran. Bail early.
  try {
    await fs.access(marker);
    console.log(`[chat-jsonl-migration] marker present (${marker}) — skip`);
    return { scanned: 0, migrated: 0, skipped: 0, errors: 0 };
  } catch {
    // marker missing — proceed.
  }

  console.log(`[chat-jsonl-migration] scanning ${root}…`);
  const files = await findChatJsonlFiles(root);
  console.log(`[chat-jsonl-migration] found ${files.length} chat.jsonl file(s)`);

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for (const file of files) {
    try {
      const result = await collapse(file);
      if (result.collapsed) {
        migrated++;
        console.log(`  migrated: ${file} (${result.count} lines collapsed)`);
      } else {
        skipped++;
      }
    } catch (err) {
      errors++;
      console.warn(`  error processing ${file}: ${(err as Error).message}`);
    }
  }

  // Drop the marker so subsequent boots are no-ops.
  try {
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(marker, new Date().toISOString() + '\n', 'utf-8');
  } catch (err) {
    console.warn(`[chat-jsonl-migration] failed to write marker: ${(err as Error).message}`);
  }

  console.log(
    `[chat-jsonl-migration] done — scanned=${files.length} migrated=${migrated} skipped=${skipped} errors=${errors}`,
  );

  return { scanned: files.length, migrated, skipped, errors };
}

// CLI: `tsx scripts/discard-legacy-chat-jsonl.ts`
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  discardLegacyChatJsonl()
    .then((r) => {
      process.exit(r.errors > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error('[chat-jsonl-migration] fatal:', err);
      process.exit(2);
    });
}
