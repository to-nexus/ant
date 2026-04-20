#!/usr/bin/env node
/**
 * ant-cli resume-job — verification scenario child-process entry point.
 *
 * A deliberately minimal "orchestrator-in-a-process" used by the verification
 * scenario runner (`scripts/verify-scenario.ts`). It exists because the full
 * production resume path (HTTP /resume → BullMQ → JobWorker.spawnJobProcess
 * → job-runner.ts) requires Redis and an API server. The L2 harness only
 * needs:
 *   1. Parse CLI args (org/user/project/feature/job/workspaceBase)
 *   2. Build a UserContext + featurePath + projectPath
 *   3. Verify the seeded session file exists
 *   4. Initialize prompt partials and call `orchestrator(...)` directly
 *   5. Emit RESULT:<json> to stdout and exit(0|1)
 *
 * Deliberately DOES NOT:
 *   - initialize Redis or realtime broadcasters (orchestrator auto-skips them
 *     when ANT_REDIS_URL is unset — the runner must leave it unset)
 *   - install SIGTERM graceful-shutdown handlers (child is expected to finish
 *     or be killed by timeout; no cloud infrastructure to notify)
 *   - import BullMQ / the job queue — this is the whole point
 *
 * See docs/testing/verification-scenarios.md § "Step A" for the rationale.
 */

// Intentionally NOT loading `dotenv/config`: the scenario runner passes a
// curated env (no ANT_REDIS_URL, no secrets) and `.env` would re-introduce
// them and cause orchestrator.ts to try to initialize realtime broadcasters.
import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import { orchestrator } from '../composition/orchestrator';
import { UnifiedWorkspaceResolver } from '../core/config/WorkspacePathResolver';
import { initPartials } from '../periphery/adapters/prompt/FilePromptAdapter';
import { getSessionFilePathByJob } from '../core/utils/sessionPaths';

interface ResumeJobArgs {
  org: string;
  user: string;
  project: string;
  feature: string;
  job: 'code' | 'design' | 'learn';
  workspaceBase: string;
}

function parseArgs(argv: string[]): ResumeJobArgs {
  const program = new Command();
  program
    .name('ant-cli resume-job')
    .description('Minimal resume entry point for the verification scenario harness')
    .requiredOption('--org <orgId>', 'Organization id (e.g. "local")')
    .requiredOption('--user <userId>', 'User id (e.g. "test")')
    .requiredOption('--project <projectId>', 'Project id inside the workspace')
    .requiredOption('--feature <featureName>', 'Feature name — sessions/architect/<job>.json must exist')
    .option('--job <jobType>', 'Job type: code | design | learn', 'code')
    .option('--workspace-base <absPath>', 'Override ANT_WORKSPACE_BASE_PATH');

  program.parse(argv, { from: 'user' });
  const opts = program.opts();

  const workspaceBase = (opts.workspaceBase as string | undefined)
    || process.env.ANT_WORKSPACE_BASE_PATH
    || '';
  if (!workspaceBase) {
    throw new Error('--workspace-base (or ANT_WORKSPACE_BASE_PATH) is required');
  }
  if (!path.isAbsolute(workspaceBase)) {
    throw new Error(`--workspace-base must be absolute: got "${workspaceBase}"`);
  }

  const job = (opts.job as string) as ResumeJobArgs['job'];
  if (!['code', 'design', 'learn'].includes(job)) {
    throw new Error(`--job must be one of: code | design | learn (got "${job}")`);
  }

  return {
    org: opts.org,
    user: opts.user,
    project: opts.project,
    feature: opts.feature,
    job,
    workspaceBase,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // ANT_PROJECT_PATH is required by FileConfigAdapter.load().
  const projectPath = path.join(args.workspaceBase, args.org, args.user, args.project);
  const featurePath = path.join(projectPath, 'features', args.feature);
  process.env.ANT_PROJECT_PATH = projectPath;
  process.env.ANT_FEATURE_PATH = featurePath;

  // Ensure minimal project config exists. The scenario runner creates these
  // ahead of time, but defending in depth keeps --list/smoke tests simple.
  const configPath = path.join(projectPath, 'config.json');
  if (!fs.existsSync(configPath)) {
    fs.mkdirSync(projectPath, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      projectName: args.project,
      repoType: 'local',
      localPath: path.join(featurePath, 'codebase'),
    }, null, 2));
  }

  const sessionPath = getSessionFilePathByJob(featurePath, args.job);
  if (!fs.existsSync(sessionPath)) {
    throw new Error(`Session seed not found at ${sessionPath} — scenario runner must write it before spawning`);
  }

  const partialResult = await initPartials();
  if (partialResult.failed.length > 0) {
    console.error(`⛔ ${partialResult.failed.length} prompt partial(s) failed to register`);
  }

  const workspaceResolver = new UnifiedWorkspaceResolver(args.workspaceBase);

  try {
    const result = await orchestrator({
      agent: 'architect',
      jobType: args.job,
      input: '',
      project: args.project,
      feature: args.feature,
      featurePath,
      projectPath,
      workspaceResolver,
      userContext: { userId: args.user, organizationId: args.org },
      // This CLI ONLY simulates resumes of seeded sessions (see file
      // docstring). Without this flag, recordUserTurn would append a spurious
      // empty user_turn to feature.jsonl on every scenario run (input=''),
      // polluting the seeded state. isResume=true makes recordUserTurn skip
      // the append and only propagate any existing turnId.
      isResume: true,
    });

    process.stdout.write(`RESULT:${JSON.stringify({ success: true, output: result })}\n`);
    await new Promise<void>((resolve) => process.stdout.write('', () => resolve()));
    process.exit(0);
  } catch (err: any) {
    const message = err?.message ?? String(err);
    console.error(`❌ [resume-job] ${message}`);
    process.stdout.write(`RESULT:${JSON.stringify({ success: false, error: message })}\n`);
    await new Promise<void>((resolve) => process.stdout.write('', () => resolve()));
    process.exit(1);
  }
}

main();
