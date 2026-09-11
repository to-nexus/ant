import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { PIPELINE_FILE_NAME, isValidCustomId, toCustomId, type PipelineDef } from '@ant/shared';
import { WorkspacePathResolver } from '../../core/config/WorkspacePathResolver';
import { discoverAgents, type CustomAgentScopeRoot } from '../../core/customAgents/CustomAgentLoader';
import { collectPipelineSaveWarningsForCatalog } from '../../core/pipelines/catalogBinding';
import { validatePipelineDefServer } from '../../core/pipelines/store';
import { EXIT, type CliResult } from './commands';

export interface ValidatePipelineOptions {
  /** Directories holding agent definition folders (the `{in}/agents` of a handoff). */
  agents?: string[];
  /** Include the shipped builtin agents in the catalog (default true). */
  builtin?: boolean;
  /** Treat catalog warnings as findings (exit 1). */
  strict?: boolean;
  builtinRoot?: string;
}

export interface ValidatePipelineJson {
  id: string | null;
  errors: string[];
  catalogWarnings: string[];
}

/**
 * Judge a `pipeline.yaml` by the save funnel's rules: `validatePipelineDefServer`
 * (what `POST /` and `PUT /:id` refuse with 400 `errors[]`) and the three
 * save-warning collectors over a catalog built from the given agent folders
 * (what the 201 carries as `catalogWarnings`, and what enable hard-fails on).
 */
export function runValidatePipeline(fileArg: string, opts: ValidatePipelineOptions = {}): CliResult<ValidatePipelineJson> {
  const file = path.resolve(fileArg);
  const usage = (msg: string): CliResult<ValidatePipelineJson> => ({
    exitCode: EXIT.USAGE,
    lines: [`error: ${msg}`],
    json: { id: null, errors: [msg], catalogWarnings: [] },
  });
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return usage(`${fileArg} is not a file`);
  }
  for (const dir of opts.agents ?? []) {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return usage(`--agents ${dir} is not a directory`);
  }

  let raw: unknown;
  try {
    raw = yaml.load(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    const msg = `Cannot read ${PIPELINE_FILE_NAME}: ${e instanceof Error ? e.message : String(e)}`;
    return { exitCode: EXIT.FINDINGS, lines: [`error: ${msg}`], json: { id: null, errors: [msg], catalogWarnings: [] } };
  }

  const errors = validatePipelineDefServer(raw);
  const lines = errors.map((e) => `error: ${e}`);
  const catalogWarnings: string[] = [];

  // The folder name is the id on import; a bare file falls back to the slug
  // the server would derive, and a name that cannot slug is a real finding.
  const parent = path.basename(path.dirname(file));
  const def = raw as Partial<PipelineDef> | null;
  let id: string | null = null;
  if (path.basename(file) === PIPELINE_FILE_NAME && isValidCustomId(parent)) {
    id = parent;
  } else if (typeof def?.name === 'string') {
    id = toCustomId(def.name) || null;
    if (!id) {
      catalogWarnings.push(
        `id: cannot derive a pipeline id from name "${def.name}" — it has no [a-z0-9] characters to slug. ` +
          `Put the file at {id}/${PIPELINE_FILE_NAME}; the folder name becomes the id on import`,
      );
    }
  }

  if (errors.length === 0) {
    const roots: CustomAgentScopeRoot[] = (opts.agents ?? []).map((root) => ({
      scope: 'user' as const,
      root: path.resolve(root),
      readonly: false,
    }));
    if (opts.builtin !== false) {
      roots.push({ scope: 'builtin', root: opts.builtinRoot ?? WorkspacePathResolver.getBuiltinAgentsPath(), readonly: true });
    }
    catalogWarnings.push(...collectPipelineSaveWarningsForCatalog(raw as PipelineDef, discoverAgents(roots)));
    lines.push(...catalogWarnings.map((w) => `warning: ${w}`));
    if (catalogWarnings.length > 0 && (opts.agents ?? []).length === 0) {
      lines.push('hint: pass --agents <dir> with the agent folders this pipeline runs, or the catalog is the builtins alone');
    }
  }

  const findings = errors.length > 0 || (opts.strict === true && catalogWarnings.length > 0);
  lines.push(
    errors.length > 0
      ? `${id ?? path.basename(file)}: ${errors.length} error(s)`
      : `ok: ${id ?? path.basename(file)} — definition valid, ${catalogWarnings.length} warning(s)`,
  );
  return {
    exitCode: findings ? EXIT.FINDINGS : EXIT.CLEAN,
    lines,
    json: { id, errors, catalogWarnings },
  };
}
