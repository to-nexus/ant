/**
 * search_code handler — ripgrep-backed.
 *
 * Contract: the `pattern` argument is a ripgrep regex (default Rust regex
 * engine; no lookaround). `file_pattern` is a ripgrep glob. This matches
 * the industry contract LLMs are trained on (Claude Code / Cursor /
 * Codex CLI all wrap ripgrep) and replaces the previous substring-based
 * implementation whose mismatch with LLM expectations forced multi-round
 * retry loops (see ocean-clinging-motif session).
 *
 * The ripgrep binary is supplied by `@vscode/ripgrep` (bundled per-platform
 * binary, no host dependency). We spawn the process directly rather than
 * going through `CommandPort` so host command allow-lists and logging do
 * not apply — `search_code` is an internal tool, not a user command.
 */

import { spawn } from 'node:child_process';
import { rgPath } from '@vscode/ripgrep';
import type { ToolExecutionContext, ToolResult } from '../types';
import { resolveToolDirectory, prependFixMessage } from './pathResolver';

const DEFAULT_EXCLUDES = ['node_modules', '.git', 'dist', 'build'];
/** Cap total result size fed back to the LLM. ripgrep's per-file `--max-count`
 *  still applies, but a pathological pattern on a large tree could otherwise
 *  produce thousands of lines; the truncator upstream would drop most of it
 *  anyway, so trim here with an explicit notice. */
const MAX_RESULT_LINES = 500;
const PER_FILE_MAX_COUNT = 200;

/**
 * Hint appended to ripgrep ENOENT messages so the operator sees a clear
 * recovery path. `@vscode/ripgrep` downloads its binary via a postinstall
 * script; pnpm 10+ blocks those by default unless the package is listed
 * under `pnpm.onlyBuiltDependencies`. When the bin/ directory is empty,
 * `spawn(rgPath, ...)` emits ENOENT at runtime. See `CLAUDE.md` →
 * "Native-Binary Dependencies" for the full recovery procedure.
 */
const RIPGREP_ENOENT_HINT =
  '\n\nHint: the ripgrep binary is missing. Run ' +
  '`env -u GITHUB_TOKEN -u GH_TOKEN node node_modules/.pnpm/@vscode+ripgrep@*/node_modules/@vscode/ripgrep/lib/postinstall.js --force` ' +
  'and verify that `@vscode/ripgrep` is listed in `pnpm.onlyBuiltDependencies` of the root `package.json` ' +
  '(pnpm 10 blocks postinstall scripts by default).';

function decorateRgError(message: string): string {
  if (message.includes('ENOENT')) return message + RIPGREP_ENOENT_HINT;
  return message;
}

async function runRipgrep(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(rgPath, args, { cwd });
    } catch (err) {
      resolve({ stdout: '', stderr: decorateRgError((err as Error).message), code: 2 });
      return;
    }
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (c: Buffer) => { stdout += c.toString(); });
    proc.stderr?.on('data', (c: Buffer) => { stderr += c.toString(); });
    proc.on('close', (code) => resolve({ stdout, stderr, code: code ?? 0 }));
    proc.on('error', (err) => resolve({ stdout: '', stderr: decorateRgError(err.message), code: 2 }));
  });
}

export async function handleSearchCode(
  ctx: ToolExecutionContext,
  args: { pattern: string; file_pattern?: string; include_dependencies?: boolean },
): Promise<ToolResult> {
  const { pattern, file_pattern, include_dependencies } = args;

  if (!pattern) {
    return { content: 'search_code requires pattern', error: 'search_code requires pattern' };
  }

  const fileSystem = ctx.fileSystem;

  const wantsWorkspaceScope = (() => {
    const fp = (file_pattern || '').replace(/\\/g, '/').replace(/^\.?\//, '');
    return fp.startsWith('features/') || fp.startsWith('inputs/') || fp.startsWith('outputs/') || fp.startsWith('sessions/');
  })();
  const resolvedRoot = await resolveToolDirectory(ctx, wantsWorkspaceScope ? 'features' : '.');

  const searchingIndex = await ctx.chatStatus.showStatus('searching_code', { pattern, file_pattern });

  try {
    const segments = resolvedRoot.fsPath.split('/');
    const isInsideDeps = segments.includes('node_modules') || segments.includes('vendor');
    // `include_dependencies=true` drops `node_modules` from excludes,
    // enabling library-grounding searches (e.g., looking up real API shape in
    // `@types/*.d.ts` when the build error suggests a version boundary). The
    // default path keeps `node_modules` excluded for performance on routine
    // project-code searches.
    let excludes: string[];
    if (isInsideDeps) {
      excludes = ['.git'];
    } else if (include_dependencies) {
      excludes = DEFAULT_EXCLUDES.filter(e => e !== 'node_modules');
    } else {
      excludes = DEFAULT_EXCLUDES;
    }

    console.log(`[searchCode] Ripgrep: ${resolvedRoot.displayPath} (fsPath: ${resolvedRoot.fsPath}, excludes: ${excludes})`);

    const rgArgs: string[] = [
      '--no-heading',
      '--line-number',
      '--color', 'never',
      '--max-count', String(PER_FILE_MAX_COUNT),
      '--max-filesize', '1M',
    ];
    for (const ex of excludes) {
      rgArgs.push('--glob', `!${ex}`);
    }
    if (file_pattern) {
      rgArgs.push('--glob', file_pattern);
    }
    // `--` so patterns starting with `-` are not parsed as flags.
    rgArgs.push('--', pattern, resolvedRoot.fsPath);

    const { stdout, stderr, code } = await runRipgrep(rgArgs, resolvedRoot.fsPath);

    // ripgrep exit codes: 0=match, 1=no match, 2+=error.
    if (code === 2) {
      const errorMsg = (stderr.trim() || 'ripgrep exited with error') +
        '\n\nHint: `pattern` is a ripgrep regex (Rust regex syntax). Escape literal regex metacharacters (. * + ? ( ) [ ] | \\).';
      console.error(`[searchCode] ripgrep error: ${stderr.trim()}`);
      await ctx.chatStatus.showStatus('searched_code', {
        pattern,
        filesCount: 0,
        totalMatches: 0,
        filesList: [],
        error: errorMsg,
        _mergeIndex: searchingIndex,
      });
      return { content: `Error: ${errorMsg}`, error: errorMsg };
    }

    let lines = stdout.split('\n').filter(l => l.length > 0);
    // Normalize absolute paths emitted by ripgrep down to repository-relative
    // so the output matches the pre-ripgrep format (`file:line: content`).
    // resolvedRoot.fsPath is the cwd we passed; strip it from each hit.
    const rootPrefix = resolvedRoot.fsPath.endsWith('/') ? resolvedRoot.fsPath : resolvedRoot.fsPath + '/';
    lines = lines.map(l => l.startsWith(rootPrefix) ? l.slice(rootPrefix.length) : l);

    if (code === 1 || lines.length === 0) {
      const errorMsg = `No matches found for pattern "${pattern}"${file_pattern ? ` in files matching "${file_pattern}"` : ''}`;
      console.error(`[searchCode] ❌ ${errorMsg}`);
      await ctx.chatStatus.showStatus('searched_code', {
        pattern,
        filesCount: 0,
        totalMatches: 0,
        filesList: [],
        error: errorMsg,
        _mergeIndex: searchingIndex,
      });
      return { content: errorMsg, error: errorMsg };
    }

    let truncatedNotice = '';
    if (lines.length > MAX_RESULT_LINES) {
      truncatedNotice = `\n\n[Search truncated: showing first ${MAX_RESULT_LINES} of ${lines.length} matches. Narrow the pattern or use \`file_pattern\` to reduce scope.]`;
      lines = lines.slice(0, MAX_RESULT_LINES);
    }

    const matchedFiles = Array.from(new Set(
      lines.map(l => {
        const m = l.match(/^([^:]+):\d+:/);
        return m ? m[1] : '';
      }).filter(Boolean),
    ));

    // `fileSystem` is reserved for future cross-process fs concerns (it is
    // intentionally unused here — ripgrep owns tree walking).
    void fileSystem;

    await ctx.chatStatus.showStatus('searched_code', {
      pattern,
      filesCount: matchedFiles.length,
      totalMatches: lines.length,
      filesList: matchedFiles,
      _mergeIndex: searchingIndex,
    });

    return { content: prependFixMessage(resolvedRoot, lines.join('\n') + truncatedNotice) };
  } catch (e) {
    const errorMsg = (e as Error).message;
    console.error(`[searchCode] ❌ Error:`, errorMsg);
    return { content: `Error: ${errorMsg}`, error: errorMsg };
  }
}
