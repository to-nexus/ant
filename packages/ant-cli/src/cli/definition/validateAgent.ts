import * as fs from 'fs';
import * as path from 'path';
import { isDefinitionIconPath, isValidCustomId, type DefinitionValidationResult } from '@ant/shared';
import { WorkspacePathResolver } from '../../core/config/WorkspacePathResolver';
import {
  admitDefinitionUpload,
  gateDefinitionSave,
  listJobIds,
  validateDefinitionSave,
} from '../../core/customAgents/definitionGate';
import { INTENT_CATALOG_CAP } from '../../core/customAgents/intents';
import { EXIT, type CliResult } from './commands';

export interface ValidateAgentOptions {
  /** Validate one job only (default: every job under `jobs/`). */
  job?: string;
  /** Override the builtin root (tests). */
  builtinRoot?: string;
}

export interface ValidateAgentJson extends DefinitionValidationResult {
  agentId: string;
  jobs: string[];
}

function walk(dir: string, rel = ''): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name.startsWith('.')) return [];
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? walk(path.join(dir, e.name), childRel) : [childRel];
  });
}

/**
 * Judge an agent definition FOLDER by the rules the server applies on the way
 * in — `gateDefinitionSave` per text file (what `PUT /file` refuses with 400),
 * `admitDefinitionUpload` per icon (what the multipart lanes skip), and the
 * `loadCustomJob` dry run with its advisories (what `GET …/validate` answers
 * `valid: false` to). The folder name is the agent id, as it is on import.
 */
export function runValidateAgent(agentDirArg: string, opts: ValidateAgentOptions = {}): CliResult<ValidateAgentJson> {
  const agentDir = path.resolve(agentDirArg);
  const agentId = path.basename(agentDir);
  const usage = (msg: string): CliResult<ValidateAgentJson> => ({
    exitCode: EXIT.USAGE,
    lines: [`error: ${msg}`],
    json: { agentId, jobs: [], valid: false, errors: [msg] },
  });
  if (!fs.existsSync(agentDir) || !fs.statSync(agentDir).isDirectory()) {
    return usage(`${agentDirArg} is not a directory`);
  }
  if (!isValidCustomId(agentId)) {
    return usage(`Agent folder name must match [a-z0-9-]+ (got: ${agentId})`);
  }
  if (!fs.existsSync(path.join(agentDir, 'agent.yaml'))) {
    return usage('The agent folder must contain agent.yaml at its root');
  }

  const errors: string[] = [];
  const builtinRoot = opts.builtinRoot ?? WorkspacePathResolver.getBuiltinAgentsPath();
  const builtinTwin = path.join(builtinRoot, agentId);
  if (fs.existsSync(builtinTwin) && path.resolve(builtinTwin) !== agentDir) {
    errors.push(`Agent id "${agentId}" is taken by a built-in agent — choose another id`);
  }

  for (const rel of walk(agentDir).sort()) {
    const abs = path.join(agentDir, rel);
    if (isDefinitionIconPath(rel)) {
      const admitted = admitDefinitionUpload(rel, fs.readFileSync(abs));
      if (!admitted.ok) errors.push(`${rel}: ${admitted.reason}`);
      continue;
    }
    const gate = gateDefinitionSave(agentId, rel, fs.readFileSync(abs, 'utf-8'), agentDir);
    if (!gate.ok) errors.push(`${rel}: ${gate.error}`);
  }

  // The save gate counts intents only when a NEW intent directory is born; a
  // finished tree needs the cap read off what is there.
  const jobsDir = path.join(agentDir, 'jobs');
  const jobDirs = fs.existsSync(jobsDir)
    ? fs.readdirSync(jobsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
    : [];
  for (const jobId of jobDirs) {
    const intentsDir = path.join(jobsDir, jobId, 'intents');
    if (!fs.existsSync(intentsDir)) continue;
    const count = fs.readdirSync(intentsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).length;
    if (count > INTENT_CATALOG_CAP) {
      errors.push(`jobs/${jobId}/intents/: catalog has ${count} intents — cap is ${INTENT_CATALOG_CAP}`);
    }
  }

  const jobs = listJobIds(agentDir).sort();
  if (jobs.length === 0) {
    errors.push('jobs/: no job carries a job.yaml — an agent with no job cannot run');
  }
  if (opts.job && !jobs.includes(opts.job)) {
    return usage(`--job ${opts.job}: no such job (have: ${jobs.join(', ') || 'none'})`);
  }

  const scopeRoots = [{ scope: 'user' as const, root: path.dirname(agentDir), readonly: false }];
  const semantic = validateDefinitionSave(scopeRoots, agentDir, agentId, opts.job ? `jobs/${opts.job}/job.yaml` : 'agent.yaml');
  errors.push(...semantic.errors);

  const valid = errors.length === 0;
  const lines = errors.map((e) => `error: ${e}`);
  lines.push(
    valid
      ? `ok: ${agentId} — ${jobs.length} job(s) load with no findings`
      : `${agentId}: ${errors.length} finding(s)`,
  );
  return {
    exitCode: valid ? EXIT.CLEAN : EXIT.FINDINGS,
    lines,
    json: { agentId, jobs, valid, errors },
  };
}
