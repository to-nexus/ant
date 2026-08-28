/**
 * search_reference_code handler — ripgrep/git-grep over a registered reference
 * project (sibling ANT project). Read-only, NO vector DB. dir-mode runs ripgrep
 * with cwd = the sibling codebase root; git-mode runs `git grep` against the
 * branch's tree (no checkout).
 *
 * `pattern` is a ripgrep/git-grep regex; `file_pattern` is a ripgrep glob
 * (dir-mode only). Mirrors the native `search_code` contract so the LLM reuses
 * the same mental model.
 */

import { spawn } from 'node:child_process';
import { rgPath } from '@vscode/ripgrep';
import type { ToolExecutionContext, ToolResult } from '../types';
import { getRefDeps, isRegistered, notRegisteredError } from '../reference/handlerSupport';
import { resolveReferenceCodebase, ReferenceTargetError } from '../reference/resolve';
import { refGitGrep } from '../reference/refGit';
import {
  boundSearchResultLines,
  MAX_COLUMNS_RG_ARGS,
  SEARCH_PER_FILE_MAX_COUNT,
} from './searchResultBounds';

const DEFAULT_EXCLUDES = ['node_modules', '.git', 'dist', 'build'];

async function runRipgrep(args: string[], cwd: string): Promise<{ stdout: string; code: number; stderr: string }> {
  return new Promise((resolve) => {
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(rgPath, args, { cwd });
    } catch (err) {
      resolve({ stdout: '', stderr: (err as Error).message, code: 2 });
      return;
    }
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (c: Buffer) => (stdout += c.toString()));
    proc.stderr?.on('data', (c: Buffer) => (stderr += c.toString()));
    proc.on('close', (code) => resolve({ stdout, stderr, code: code ?? 0 }));
    proc.on('error', (err) => resolve({ stdout: '', stderr: err.message, code: 2 }));
  });
}

export async function handleSearchReferenceCode(
  ctx: ToolExecutionContext,
  args: { project: string; pattern: string; file_pattern?: string; branch?: string },
): Promise<ToolResult> {
  const { project, pattern, file_pattern, branch } = args;
  if (!project || !pattern) {
    const msg = 'search_reference_code requires "project" and "pattern"';
    return { content: msg, error: msg };
  }
  if (!isRegistered(ctx, project)) {
    const msg = notRegisteredError(project, ctx);
    return { content: msg, error: msg };
  }

  const deps = getRefDeps(ctx);
  if ('error' in deps) return { content: deps.error, error: deps.error };

  const searchingIndex = await ctx.chatStatus.showStatus('searching_reference', { project, query: pattern });

  try {
    const resolution = await resolveReferenceCodebase(
      deps.workspaceResolver,
      deps.userContext,
      { project, branch },
      ctx.project,
    );

    let lines: string[];
    if (resolution.mode === 'git') {
      const out = await refGitGrep(resolution.gitDir, resolution.ref, pattern, file_pattern);
      lines = out.split('\n').filter(Boolean);
    } else {
      const rgArgs = [
        '--no-heading',
        '--line-number',
        '--color', 'never',
        '--max-count', String(SEARCH_PER_FILE_MAX_COUNT),
        '--max-filesize', '1M',
        ...MAX_COLUMNS_RG_ARGS,
        ...DEFAULT_EXCLUDES.flatMap((ex) => ['--glob', `!${ex}`]),
        ...(file_pattern ? ['--glob', file_pattern] : []),
        '--', pattern, '.',
      ];
      const { stdout, stderr, code } = await runRipgrep(rgArgs, resolution.absPath);
      if (code === 2) {
        const msg =
          (stderr.trim() || 'ripgrep exited with error') +
          '\n\nHint: `pattern` is a ripgrep regex (Rust regex syntax).';
        await ctx.chatStatus.showStatus('searched_reference', { project, filesCount: 0, error: msg, _mergeIndex: searchingIndex });
        return { content: `Error: ${msg}`, error: msg };
      }
      lines = stdout.split('\n').filter(Boolean).map((l) => (l.startsWith('./') ? l.slice(2) : l));
    }

    if (lines.length === 0) {
      await ctx.chatStatus.showStatus('searched_reference', { project, filesCount: 0, _mergeIndex: searchingIndex });
      return { content: `No matches for "${pattern}" in reference project "${project}".` };
    }

    // git-grep output bypasses ripgrep's --max-columns — the process-side
    // bound below is what keeps a single bundled/JSON line from flooding.
    const boundedResult = boundSearchResultLines(lines);
    lines = boundedResult.lines;
    const truncated = boundedResult.notice;
    const matchedFiles = Array.from(
      new Set(lines.map((l) => (l.match(/^([^:]+):\d+:/) || [])[1]).filter(Boolean)),
    );
    await ctx.chatStatus.showStatus('searched_reference', {
      project,
      filesCount: matchedFiles.length,
      _mergeIndex: searchingIndex,
    });

    return { content: `[${project}] matches:\n\n${lines.join('\n')}${truncated}` };
  } catch (e) {
    const msg = e instanceof ReferenceTargetError ? e.message : (e as Error).message;
    console.error(`[searchReferenceCode] ❌ ${msg}`);
    try {
      await ctx.chatStatus.showStatus('searched_reference', { project, filesCount: 0, error: msg, _mergeIndex: searchingIndex });
    } catch {
      /* ignore status errors */
    }
    return { content: `Error: ${msg}`, error: msg };
  }
}
