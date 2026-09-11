import * as fs from 'fs';
import * as path from 'path';
import { WorkspacePathResolver } from '../../core/config/WorkspacePathResolver';
import { resolveSourceRoot } from '../../agents/common/tool/antSource/core';
import {
  BUILDER_HANDOFFS,
  composeBuilderHandoff,
  findBuilderHandoff,
  handoffReadList,
  type HandoffRoots,
} from '../../core/customAgents/builderHandoff';
import { EXIT, type CliResult } from './commands';

export interface HandoffOptions {
  /** Write the bundle here instead of returning it as the output line. */
  out?: string;
  roots?: Partial<HandoffRoots>;
}

export interface HandoffJson {
  agentId: string;
  jobId: string;
  intentId: string;
  bytes: number;
  files: string[];
  out?: string;
}

/** The bundle the route serves, composed from this clone — for a person handing a file to an agent that has no Ant access. */
export function runHandoff(agentId: string, jobId: string, intentId: string, opts: HandoffOptions = {}): CliResult<HandoffJson | null> {
  const spec = findBuilderHandoff(agentId, jobId, intentId);
  if (!spec) {
    const known = BUILDER_HANDOFFS.map((h) => `${h.agentId} ${h.jobId} ${h.intentId}`).join(' · ');
    return { exitCode: EXIT.USAGE, lines: [`error: no handoff for ${agentId}/${jobId}/${intentId} — known: ${known}`], json: null };
  }
  const docsRoot = opts.roots?.docsRoot ?? resolveSourceRoot('docs');
  const examplesRoot = opts.roots?.examplesRoot ?? path.resolve(docsRoot, '..', 'examples');
  const roots: HandoffRoots = {
    agentsRoot: opts.roots?.agentsRoot ?? WorkspacePathResolver.getBuiltinAgentsPath(),
    docsRoot,
    ...(fs.existsSync(examplesRoot) ? { examplesRoot } : {}),
  };
  const bundle = composeBuilderHandoff(spec, roots);
  const json: HandoffJson = {
    agentId,
    jobId,
    intentId,
    bytes: Buffer.byteLength(bundle, 'utf-8'),
    files: handoffReadList(spec, roots.agentsRoot),
  };
  if (opts.out) {
    const out = path.resolve(opts.out);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, bundle, 'utf-8');
    return { exitCode: EXIT.CLEAN, lines: [`wrote: ${out} (${json.bytes} bytes, ${json.files.length} contract files)`], json: { ...json, out } };
  }
  return { exitCode: EXIT.CLEAN, lines: [bundle.trimEnd()], json };
}
