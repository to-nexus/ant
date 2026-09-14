import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {
  PIPELINE_FILE_NAME,
  isApprovalStep,
  isValidCustomId,
  parseCustomJobRef,
  toCustomId,
  type PipelineDef,
} from '@ant/shared';
import { WorkspacePathResolver } from '../../core/config/WorkspacePathResolver';
import { discoverAgents, type CustomAgentScopeRoot } from '../../core/customAgents/CustomAgentLoader';
import { EXIT, type CliResult } from './commands';
import { extractTableUnder, isPlaceholderRow, parseCountLine, sectionBody, sectionHeadings } from './markdownTable';

/**
 * The build reports' structural headings, in skeleton order — the pipeline
 * builder's `pipeline-report/{flowId}.md` and the agent builder's
 * `dependency-report/{agentId}.md`. The skeletons in each builder's
 * `intents/build/prompt.md` are the source; the CLI test holds these lists
 * against them.
 */
export const PIPELINE_REPORT_SECTIONS = [
  'Flow',
  'Intent coverage',
  'Seams',
  'Relays',
  'Substitutes',
  'Intent changes this flow needs',
  'Outcome coverage',
  'Run entry',
  'Judgment calls',
  'Left to a person',
] as const;

/** The fixed tail after the per-counterpart entries. */
export const DEPENDENCY_REPORT_SECTIONS = ['Mapping as built', 'Hook decisions', 'Deliverable contracts', 'Judgment calls'] as const;

const NOT_SCHEDULED = 'not scheduled';

export interface CheckReportOptions {
  /** Pipeline lane: `{pipelineId}/pipeline.yaml` folders, containers of them, or bare yaml files. */
  pipelines?: string[];
  /** Pipeline lane: containers of agent definition folders — the coverage universe. */
  agents?: string[];
  /** Agent lane: the one definition folder — its name is the agent id. */
  agent?: string;
  /** Pipeline lane: add the shipped builtin agents to the universe (default false). */
  builtin?: boolean;
  builtinRoot?: string;
}

export interface CheckReportFinding {
  kind:
    | 'section-missing'
    | 'section-order'
    | 'count-line-missing'
    | 'count-mismatch'
    | 'table-missing'
    | 'missing'
    | 'unknown'
    | 'mismatch'
    | 'unreasoned'
    | 'unaccounted-step'
    | 'unmapped-intent'
    | 'missing-job';
  subject: string;
}

export interface CheckReportJson {
  lane: 'pipeline' | 'agent' | null;
  findings: CheckReportFinding[];
  counts: Record<string, number>;
}

interface LoadedPipeline {
  id: string;
  def: PipelineDef;
}

function readYamlDef(file: string): PipelineDef | null {
  try {
    const raw = yaml.load(fs.readFileSync(file, 'utf-8'));
    return raw && typeof raw === 'object' && Array.isArray((raw as PipelineDef).steps) ? (raw as PipelineDef) : null;
  } catch {
    return null;
  }
}

/** Same id derivation as the import: the folder name, else the slug of `name`. */
function loadPipelineFile(file: string): LoadedPipeline | null {
  const def = readYamlDef(file);
  if (!def) return null;
  const parent = path.basename(path.dirname(file));
  const id =
    path.basename(file) === PIPELINE_FILE_NAME && isValidCustomId(parent) ? parent : toCustomId(def.name ?? '') || null;
  return id ? { id, def } : null;
}

function loadPipelines(arg: string): LoadedPipeline[] {
  const abs = path.resolve(arg);
  if (fs.statSync(abs).isFile()) {
    const one = loadPipelineFile(abs);
    return one ? [one] : [];
  }
  const own = path.join(abs, PIPELINE_FILE_NAME);
  if (fs.existsSync(own)) {
    const one = loadPipelineFile(own);
    return one ? [one] : [];
  }
  return fs
    .readdirSync(abs, { withFileTypes: true })
    .flatMap((e) => {
      if (e.name.startsWith('.')) return [];
      const child = path.join(abs, e.name);
      if (e.isDirectory()) {
        const nested = path.join(child, PIPELINE_FILE_NAME);
        return fs.existsSync(nested) ? [loadPipelineFile(nested)] : [];
      }
      return /\.ya?ml$/i.test(e.name) ? [loadPipelineFile(child)] : [];
    })
    .filter((p): p is LoadedPipeline => p !== null);
}

function checkSections(report: string, required: readonly string[], findings: CheckReportFinding[]): void {
  const headings = sectionHeadings(report);
  let last = -1;
  let ordered = true;
  for (const name of required) {
    const at = headings.indexOf(name);
    if (at === -1) {
      findings.push({ kind: 'section-missing', subject: `## ${name}` });
      continue;
    }
    if (at < last) ordered = false;
    last = at;
  }
  if (!ordered) findings.push({ kind: 'section-order', subject: `expected ${required.map((s) => `## ${s}`).join(' → ')}` });
}

function expectCount(counts: Record<string, number>, key: string, actual: number, findings: CheckReportFinding[]): void {
  if (!(key in counts)) {
    findings.push({ kind: 'count-mismatch', subject: `${key}: absent from the count line (definitions say ${actual})` });
  } else if (counts[key] !== actual) {
    findings.push({ kind: 'count-mismatch', subject: `${key}: ${counts[key]} (report) vs ${actual} (definitions)` });
  }
}

function catalogRoots(agentDirs: string[], opts: CheckReportOptions): CustomAgentScopeRoot[] {
  const roots: CustomAgentScopeRoot[] = agentDirs.map((root) => ({ scope: 'user' as const, root: path.resolve(root), readonly: false }));
  if (opts.builtin === true) {
    roots.push({ scope: 'builtin', root: opts.builtinRoot ?? WorkspacePathResolver.getBuiltinAgentsPath(), readonly: true });
  }
  return roots;
}

function checkPipelineLane(report: string, pipelines: LoadedPipeline[], opts: CheckReportOptions): CheckReportJson {
  const findings: CheckReportFinding[] = [];
  checkSections(report, PIPELINE_REPORT_SECTIONS, findings);

  // The universe: every intent the given agents declare, as `agent/job/intent`;
  // a job with no intent catalog is addressable only as `agent/job`.
  const agents = discoverAgents(catalogRoots(opts.agents ?? [], opts));
  const universe = new Set<string>();
  const jobKeys = new Set<string>();
  for (const agent of agents) {
    for (const job of agent.jobs) {
      jobKeys.add(`${agent.id}/${job.id}`);
      for (const intent of job.intents ?? []) universe.add(`${agent.id}/${job.id}/${intent.id}`);
    }
  }

  // What each job step actually runs, keyed `pipelineId/stepId`.
  const stepRuns = new Map<string, string>();
  for (const { id, def } of pipelines) {
    for (const step of def.steps) {
      if (isApprovalStep(step)) continue;
      const ref = parseCustomJobRef(step.customJobRef);
      const runs = ref ? `${ref.agentId}/${ref.jobId}${step.intent ? `/${step.intent}` : ''}` : step.customJobRef;
      stepRuns.set(`${id}/${step.id}`, runs);
    }
  }

  const table = extractTableUnder(report, /^Intent coverage$/);
  const scheduled = new Set<string>();
  const notScheduled = new Set<string>();
  const accounted = new Set<string>();
  if (!table) {
    findings.push({ kind: 'table-missing', subject: '## Intent coverage — no table' });
  } else {
    for (const row of table.rows) {
      if (isPlaceholderRow(row.slice(0, 1)) || !row[0]) continue;
      const [key, runsAt = '', note = ''] = row;
      const known = universe.has(key) || jobKeys.has(key);
      if (!known) findings.push({ kind: 'unknown', subject: key });
      if (runsAt.toLowerCase() === NOT_SCHEDULED) {
        if (known) notScheduled.add(key);
        if (note.trim().length === 0) findings.push({ kind: 'unreasoned', subject: `${key} — not scheduled, no reason` });
        continue;
      }
      for (const stepRef of runsAt.split(/[,·]/).map((s) => s.trim()).filter(Boolean)) {
        accounted.add(stepRef);
        const actual = stepRuns.get(stepRef);
        if (actual === undefined) {
          findings.push({ kind: 'mismatch', subject: `${key} → ${stepRef}: no such job step in the given pipelines` });
        } else if (actual !== key) {
          findings.push({ kind: 'mismatch', subject: `${key} → ${stepRef}: that step runs ${actual}` });
        } else if (known) {
          scheduled.add(key);
        }
      }
    }
    for (const key of Array.from(universe).sort()) {
      if (!scheduled.has(key) && !notScheduled.has(key)) findings.push({ kind: 'missing', subject: key });
    }
    for (const stepRef of Array.from(stepRuns.keys()).sort()) {
      if (!accounted.has(stepRef)) findings.push({ kind: 'unaccounted-step', subject: `${stepRef} (runs ${stepRuns.get(stepRef)})` });
    }
  }

  const counts = parseCountLine(report);
  if (!counts) {
    findings.push({ kind: 'count-line-missing', subject: 'pipelines: N · boundaries: N−1 · intents: M · scheduled: K · not scheduled: M−K' });
  } else {
    expectCount(counts, 'pipelines', pipelines.length, findings);
    expectCount(counts, 'boundaries', Math.max(0, pipelines.length - 1), findings);
    expectCount(counts, 'intents', universe.size, findings);
    if (table) {
      expectCount(counts, 'scheduled', scheduled.size, findings);
      expectCount(counts, NOT_SCHEDULED, notScheduled.size, findings);
    }
  }

  return {
    lane: 'pipeline',
    findings,
    counts: {
      pipelines: pipelines.length,
      intents: universe.size,
      scheduled: scheduled.size,
      'not scheduled': notScheduled.size,
      steps: stepRuns.size,
    },
  };
}

function checkAgentLane(report: string, agentDir: string, opts: CheckReportOptions): CheckReportJson | string {
  const agentId = path.basename(agentDir);
  const agent = discoverAgents([{ scope: 'user', root: path.dirname(agentDir), readonly: false }]).find((a) => a.id === agentId);
  if (!agent) return `${agentDir} does not hold an agent definition (agent.yaml with id "${agentId}")`;
  void opts;

  const findings: CheckReportFinding[] = [];
  checkSections(report, DEPENDENCY_REPORT_SECTIONS, findings);

  const jobIds = agent.jobs.map((j) => j.id);
  const intents = agent.jobs.flatMap((j) => (j.intents ?? []).map((i) => `${j.id}/${i.id}`));

  const table = extractTableUnder(report, /^Mapping as built$/);
  let mapped = 0;
  let dropped = 0;
  if (!table) {
    findings.push({ kind: 'table-missing', subject: '## Mapping as built — no table' });
  } else {
    const performedBy: string[] = [];
    for (const row of table.rows) {
      if (isPlaceholderRow(row)) continue;
      const cell = row[1] ?? '';
      performedBy.push(cell);
      if (/^dropped\b/i.test(cell.trim())) dropped += 1;
      else if (row[0] !== '—') mapped += 1;
    }
    const joined = performedBy.join('\n');
    for (const key of intents) {
      if (!new RegExp(`(^|[^a-z0-9/-])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9-])`).test(joined)) {
        findings.push({ kind: 'unmapped-intent', subject: key });
      }
    }
    // A `{jobId}/{x}` token whose job exists but whose intent does not names
    // work the definition cannot perform.
    const known = new Set(intents);
    for (const m of joined.matchAll(/(?:^|[^a-z0-9/-])([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)(?![a-z0-9/-])/g)) {
      const token = `${m[1]}/${m[2]}`;
      if (jobIds.includes(m[1]) && !known.has(token)) findings.push({ kind: 'unknown', subject: token });
    }
  }

  const hooks = sectionBody(report, /^Hook decisions$/);
  if (hooks !== null) {
    for (const jobId of jobIds) {
      if (!new RegExp(`(^|[^a-z0-9-])${jobId}(?![a-z0-9-])`, 'm').test(hooks)) {
        findings.push({ kind: 'missing-job', subject: `## Hook decisions names no line for job "${jobId}"` });
      }
    }
  }

  const counts = parseCountLine(report);
  if (!counts) {
    findings.push({ kind: 'count-line-missing', subject: 'jobs: J · intents: I · units mapped: U · dropped: D' });
  } else {
    expectCount(counts, 'jobs', jobIds.length, findings);
    expectCount(counts, 'intents', intents.length, findings);
    if (table) {
      expectCount(counts, 'units mapped', mapped, findings);
      expectCount(counts, 'dropped', dropped, findings);
    }
  }

  return {
    lane: 'agent',
    findings,
    counts: { jobs: jobIds.length, intents: intents.length, 'units mapped': mapped, dropped },
  };
}

/**
 * Hold a build report against the definitions it claims to describe — the
 * pipeline builder's flow report against the pipelines and the agents they
 * run, the agent builder's dependency report against the definition folder.
 * Existence is the stop hook's job; this is the reader's check that the
 * report accounts for every intent, and that what it says a step runs is
 * what the saved definition runs. An offline reviewer's tool: nothing in the
 * runtime reads these reports, and nothing here changes that.
 */
export function runCheckReport(reportArg: string, opts: CheckReportOptions = {}): CliResult<CheckReportJson> {
  const empty: CheckReportJson = { lane: null, findings: [], counts: {} };
  const usage = (msg: string): CliResult<CheckReportJson> => ({ exitCode: EXIT.USAGE, lines: [`error: ${msg}`], json: empty });

  const report = path.resolve(reportArg);
  if (!fs.existsSync(report) || !fs.statSync(report).isFile()) return usage(`${reportArg} is not a file`);
  const pipelineLane = (opts.pipelines ?? []).length > 0;
  const agentLane = typeof opts.agent === 'string';
  if (pipelineLane === agentLane) {
    return usage('pass --pipelines <dir>... with --agents <dir>... for a flow report, or --agent <agentDir> for a dependency report — one lane, not both');
  }
  for (const dir of [...(opts.pipelines ?? []), ...(opts.agents ?? []), ...(agentLane ? [opts.agent!] : [])]) {
    if (!fs.existsSync(dir)) return usage(`${dir} does not exist`);
  }
  if (pipelineLane && (opts.agents ?? []).length === 0 && opts.builtin !== true) {
    return usage('--agents <dir>... is required: the agents the flow runs are the coverage universe');
  }

  const text = fs.readFileSync(report, 'utf-8');
  let json: CheckReportJson;
  if (pipelineLane) {
    const pipelines = (opts.pipelines ?? []).flatMap(loadPipelines);
    if (pipelines.length === 0) return usage(`no ${PIPELINE_FILE_NAME} found under ${(opts.pipelines ?? []).join(', ')}`);
    json = checkPipelineLane(text, pipelines, opts);
  } else {
    const result = checkAgentLane(text, path.resolve(opts.agent!), opts);
    if (typeof result === 'string') return usage(result);
    json = result;
  }

  const summary = Object.entries(json.counts)
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ');
  const lines = [
    ...json.findings.map((f) => `${f.kind}: ${f.subject}`),
    json.findings.length === 0 ? `ok: ${json.lane} report accounts for its definitions — ${summary}` : `${json.findings.length} finding(s) — ${summary}`,
  ];
  return { exitCode: json.findings.length > 0 ? EXIT.FINDINGS : EXIT.CLEAN, lines, json };
}
