/**
 * Universal thread container reverse-lookup.
 *
 * On universal-type projects the FE rides the threadId in the `:feature` URL
 * slot (chat, feature-log, job routes). Feature-path consumers that only have
 * (projectPath, featureName) can resolve the actual thread container with
 * this scan — bounded by the number of custom agents × jobs, and gated on the
 * project actually being universal-type so canonical projects pay one config
 * read at most.
 */

import * as fs from 'fs';
import * as path from 'path';
import { isValidCustomId } from '@ant/shared';

function isUniversalProject(projectPath: string): boolean {
  try {
    const raw = fs.readFileSync(path.join(projectPath, 'config.json'), 'utf-8');
    return JSON.parse(raw)?.projectType === 'universal';
  } catch {
    return false;
  }
}

/**
 * Returns the thread container path for `threadId` inside `projectPath`, or
 * null when the project is not universal-type, the id is malformed, or no
 * such thread exists yet (fresh thread — the first job run creates it).
 */
export function resolveUniversalThreadPath(projectPath: string, threadId: string): string | null {
  if (!isValidCustomId(threadId)) return null;
  if (!isUniversalProject(projectPath)) return null;
  const agentsRoot = path.join(projectPath, 'universal', 'agents');
  let agentDirs: fs.Dirent[];
  try {
    agentDirs = fs.readdirSync(agentsRoot, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch {
    return null;
  }
  for (const agent of agentDirs) {
    const agentPath = path.join(agentsRoot, agent.name);
    let jobDirs: fs.Dirent[];
    try {
      jobDirs = fs.readdirSync(agentPath, { withFileTypes: true }).filter((e) => e.isDirectory());
    } catch {
      continue;
    }
    for (const job of jobDirs) {
      const candidate = path.join(agentPath, job.name, 'threads', threadId);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}
