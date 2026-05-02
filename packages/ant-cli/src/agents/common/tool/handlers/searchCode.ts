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
import { existsSync } from 'node:fs';
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
 * Hint appended when ripgrep is genuinely missing on disk (postinstall
 * was blocked or never ran). `@vscode/ripgrep` downloads its binary via
 * a postinstall script; pnpm 10+ blocks those by default unless the
 * package is listed under `pnpm.onlyBuiltDependencies`. See `CLAUDE.md` →
 * "Native-Binary Dependencies" for the full recovery procedure.
 */
const RIPGREP_BINARY_MISSING_HINT =
  '\n\nHint: the ripgrep binary is missing. Run ' +
  '`env -u GITHUB_TOKEN -u GH_TOKEN node node_modules/.pnpm/@vscode+ripgrep@*/node_modules/@vscode/ripgrep/lib/postinstall.js --force` ' +
  'and verify that `@vscode/ripgrep` is listed in `pnpm.onlyBuiltDependencies` of the root `package.json` ' +
  '(pnpm 10 blocks postinstall scripts by default).';

/**
 * Hint appended when ripgrep IS installed but spawn still produced ENOENT.
 * Almost always caused by passing a non-existent or unreadable cwd —
 * Node's spawn surfaces ENOENT against the binary path even when the
 * real culprit is the working directory. (vast-curling-perch RCA.)
 */
const RIPGREP_CWD_ENOENT_HINT =
  '\n\nHint: ripgrep binary is present, so this ENOENT means the spawn cwd ' +
  "or search root does not exist (or isn't readable). Verify the directory " +
  'is mounted and the path is workspace-relative.';

/**
 * Decorate raw spawn errors with a hint that points at the *real* cause.
 * Distinguishing binary-missing vs cwd-missing matters: the wrong hint
 * sends operators down a useless postinstall loop while the real fix is
 * elsewhere.
 */
export function decorateRgError(message: string, binaryExists: boolean = existsSync(rgPath)): string {
  if (!message.includes('ENOENT')) return message;
  return message + (binaryExists ? RIPGREP_CWD_ENOENT_HINT : RIPGREP_BINARY_MISSING_HINT);
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
  if (!fileSystem) {
    return { content: 'search_code requires fileSystem', error: 'search_code requires fileSystem' };
  }

  const wantsWorkspaceScope = (() => {
    const fp = (file_pattern || '').replace(/\\/g, '/').replace(/^\.?\//, '');
    return (
      fp.startsWith('features/') ||
      fp.startsWith('plan/') ||
      fp.startsWith('architecture/') ||
      fp.startsWith('visual/') ||
      fp.startsWith('assets/') ||
      fp.startsWith('meta/') ||
      fp.startsWith('sessions/')
    );
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

    // Resolve to an absolute filesystem path. `resolvedRoot.fsPath` is
    // workspace-relative (e.g. `codebase/`) — passing that as `spawn`'s cwd
    // would make Node resolve it against `process.cwd()` (the server's CWD,
    // not the workspace root) and fail with ENOENT against the *binary path*,
    // disguising the real cause. Use the port's traversal-protected
    // resolver so all native-spawn callers share one absolute-path SSOT.
    const absRoot = fileSystem.resolveAbsolute(resolvedRoot.fsPath);
    if (!existsSync(absRoot)) {
      const errorMsg =
        `Search root does not exist: ${resolvedRoot.displayPath} (resolved to ${absRoot}). ` +
        `Verify the directory is part of the workspace and try a path that exists.`;
      console.error(`[searchCode] ${errorMsg}`);
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

    console.log(`[searchCode] Ripgrep: ${resolvedRoot.displayPath} (absRoot: ${absRoot}, excludes: ${excludes})`);

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
    // Pass `.` as the search root since cwd is already absRoot — keeps
    // ripgrep's emitted paths short and our normalize step trivial.
    rgArgs.push('--', pattern, '.');

    const { stdout, stderr, code } = await runRipgrep(rgArgs, absRoot);

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
    // ripgrep emits paths relative to the search root (`.`), e.g. `foo.ts:12: ...`.
    // Strip the leading `./` so output stays clean and matches the pre-ripgrep
    // format (`file:line: content`). The displayPath context is preserved by
    // `prependFixMessage` if a path-correction notice is active.
    lines = lines.map(l => (l.startsWith('./') ? l.slice(2) : l));

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
