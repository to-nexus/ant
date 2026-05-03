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
import type { FileSystemPort } from '../../../../core/ports/filesystem';
import { normalizeToCodebasePath } from '../../../../core/utils/pathNormalizer';
import type { ToolExecutionContext, ToolResult } from '../types';

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

/**
 * Compose a zero-match response that tells the LLM/operator *why* the
 * search came back empty — distinguishing "really no occurrences" from
 * "your file_pattern was rewritten" from "exclude / .gitignore cut the
 * tree you wanted". Without this context an empty result gets
 * misread as ground truth and the agent loops on the wrong assumption
 * (the next-intl session was an exact instance of that loop).
 */
export function formatZeroMatchMessage(
  pattern: string,
  rawFilePattern: string | undefined,
  plan: SearchPlan,
): string {
  const headline = `No matches found for pattern "${pattern}"` +
    (plan.effectiveFilePattern ? ` in files matching "${plan.effectiveFilePattern}"` : '');

  const ctxLines: string[] = [];
  ctxLines.push(`  cwd: ${plan.cwd}`);
  if (rawFilePattern && rawFilePattern !== plan.effectiveFilePattern) {
    ctxLines.push(`  file_pattern normalized: "${rawFilePattern}" → "${plan.effectiveFilePattern}"`);
  }
  ctxLines.push(`  appliedExcludes: ${plan.appliedExcludes.join(', ') || '(none)'}`);
  const depsNote = plan.effectiveIncludeDeps
    ? (rawFilePattern && /(^|\/)(node_modules|vendor)(\/|$)/.test(plan.effectiveFilePattern || '')
        ? ' (auto-inferred from file_pattern targeting node_modules/vendor)'
        : '')
    : '';
  ctxLines.push(`  include_dependencies: ${plan.effectiveIncludeDeps}${depsNote}`);
  ctxLines.push(`  deps-tree walk (--no-ignore --hidden --follow): ${plan.walkDepsTree}`);

  return `${headline}\n\n[search context]\n${ctxLines.join('\n')}`;
}

export interface SearchPlan {
  /** Absolute cwd handed to `spawn`. Always the workspace root so file_pattern
   *  semantics match other tool handlers (`read_file` / `edit_file`) — every
   *  glob is workspace-rel, no second prefix layer to think about. */
  cwd: string;
  /** `file_pattern` after `normalizeToCodebasePath` — the SSOT used by 15+
   *  other handlers for codebase/sibling-prefix decisions. */
  effectiveFilePattern: string | undefined;
  /** Notice surfaced to the LLM when normalize had to correct the input
   *  (e.g. `codebase/codebase/...` → `codebase/...`, or bare `**` → `codebase/**`). */
  filePatternFix: string | undefined;
  effectiveIncludeDeps: boolean;
  /** Glob basenames passed to ripgrep as `--glob !<name>`. Surfaced in
   *  zero-match diagnostics so the LLM/operator can see why a search came
   *  back empty. */
  appliedExcludes: string[];
  /** Dependency-tree walk mode — couples `--no-ignore`, `--hidden`, and
   *  `--follow` on the ripgrep invocation. Off by default; on whenever
   *  `effectiveIncludeDeps` is true. All three flags are required to
   *  reach installed library code in pnpm/npm/yarn workspaces: gitignore
   *  bypass + hidden `.pnpm/` dir + symlink resolution at the declared
   *  package path. */
  walkDepsTree: boolean;
  rgArgs: string[];
}

/**
 * One function captures every search-shape decision the handler makes —
 * cwd, file_pattern normalization, dependency-mode inference, ripgrep
 * flag construction. Keeps the handler body a thin wrapper: build a plan,
 * spawn with it, format the result. Also makes the planning logic
 * trivially unit-testable in isolation.
 */
export function planSearch(
  args: { pattern: string; file_pattern?: string; include_dependencies?: boolean },
  fileSystem: FileSystemPort,
): SearchPlan {
  // ── file_pattern normalize via the existing SSOT ──────────────────────
  // `normalizeToCodebasePath` is the same helper that read_file / edit_file
  // / createFile / runCommand / FileRenderer / 11+ other call sites use to
  // decide "is this a codebase path or a sibling (features/, plan/, ...)
  // path?". Routing search_code through it eliminates the previous
  // `wantsWorkspaceScope` private branch (same domain, duplicated logic)
  // and the codebase/-prefix double-up that produced the next-intl false
  // negative.
  let effectiveFilePattern: string | undefined;
  let filePatternFix: string | undefined;
  if (args.file_pattern) {
    const norm = normalizeToCodebasePath(args.file_pattern);
    effectiveFilePattern = norm.normalized;
    if (norm.wasFixed) {
      filePatternFix =
        `file_pattern auto-corrected: "${args.file_pattern}" → "${norm.normalized}"` +
        (norm.reason ? ` (${norm.reason})` : '');
      console.warn(`\n[searchCode] PATH AUTO-FIX: ${norm.reason}`);
      console.warn(`   Requested: ${args.file_pattern}`);
      console.warn(`   Corrected: ${norm.normalized}\n`);
    }
  }

  // ── dependency mode (explicit + auto-inferred) ────────────────────────
  // Auto-infer when file_pattern explicitly targets node_modules/ or
  // vendor/ — the LLM's intent is library grounding, so silently dropping
  // the dependency-exclude glob (which would defeat the search) and
  // demanding a redundant `include_dependencies: true` is exactly the
  // false-negative producer the next-intl RCA exposed.
  const filePatternTargetsDeps =
    !!effectiveFilePattern &&
    /(^|\/)(node_modules|vendor)(\/|$)/.test(effectiveFilePattern);
  const effectiveIncludeDeps = !!args.include_dependencies || filePatternTargetsDeps;

  const appliedExcludes = effectiveIncludeDeps
    ? ['.git']
    : DEFAULT_EXCLUDES;

  // Dependency-tree walk knob — couples `--no-ignore`, `--hidden`, and
  // `--follow` because all three are required to actually reach
  // installed library code in the most common JS/TS topologies:
  //
  //   - `--no-ignore` defeats the workspace's `.gitignore node_modules/`
  //     entry (every JS/TS workspace has it).
  //   - `--hidden` is required for pnpm. pnpm stores actual content at
  //     `node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>/...` —
  //     `.pnpm` is hidden, so without `--hidden` ripgrep never enters it.
  //   - `--follow` resolves the symlink at `node_modules/<pkg>` (the
  //     LLM-friendly declared path) onto the real `.pnpm/...` content.
  //     Without it, file_pattern globs like
  //     `codebase/apps/hub/node_modules/next-intl/**` match zero files
  //     because ripgrep emits paths at their REAL location, not the
  //     symlinked one. (npm/yarn flat layouts don't need this, but the
  //     flag is harmless there — same files, no extra paths.)
  //
  // `.git/` stays hard-excluded above so `--hidden` cannot leak VCS
  // internals. `--follow` follows symlinks freely; deps mode is an
  // intentional library-grounding bundle so the wider reach is the
  // intended trade.
  const walkDepsTree = effectiveIncludeDeps;

  // ── ripgrep argv ──────────────────────────────────────────────────────
  // cwd = workspace root (always exists, FileSystemAdapter constructor
  // mkdirs it). `.` as search root means ripgrep emits workspace-rel
  // paths verbatim — no post-strip needed beyond the one-off `./` cleanup
  // ripgrep adds when given `.` as a positional.
  const rgArgs = [
    '--no-heading',
    '--line-number',
    '--color', 'never',
    '--max-count', String(PER_FILE_MAX_COUNT),
    '--max-filesize', '1M',
    ...(walkDepsTree ? ['--no-ignore', '--hidden', '--follow'] : []),
    ...appliedExcludes.flatMap(ex => ['--glob', `!${ex}`]),
    ...(effectiveFilePattern ? ['--glob', effectiveFilePattern] : []),
    // `--` so patterns starting with `-` are not parsed as flags.
    '--', args.pattern, '.',
  ];

  return {
    cwd: fileSystem.getRootPath(),
    effectiveFilePattern,
    filePatternFix,
    effectiveIncludeDeps,
    appliedExcludes,
    walkDepsTree,
    rgArgs,
  };
}

export async function handleSearchCode(
  ctx: ToolExecutionContext,
  args: { pattern: string; file_pattern?: string; include_dependencies?: boolean },
): Promise<ToolResult> {
  const { pattern, file_pattern } = args;

  if (!pattern) {
    return { content: 'search_code requires pattern', error: 'search_code requires pattern' };
  }

  const fileSystem = ctx.fileSystem;
  if (!fileSystem) {
    return { content: 'search_code requires fileSystem', error: 'search_code requires fileSystem' };
  }

  const plan = planSearch(args, fileSystem);

  const searchingIndex = await ctx.chatStatus.showStatus('searching_code', { pattern, file_pattern });

  try {
    if (!existsSync(plan.cwd)) {
      const errorMsg =
        `Workspace root does not exist: ${plan.cwd}. ` +
        `Verify the workspace is initialized and mounted.`;
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

    console.log(
      `[searchCode] Ripgrep: cwd=${plan.cwd}, file_pattern=${plan.effectiveFilePattern ?? '(none)'}, ` +
      `excludes=${plan.appliedExcludes.join(',')}, includeDeps=${plan.effectiveIncludeDeps}, walkDepsTree=${plan.walkDepsTree}`,
    );

    const { stdout, stderr, code } = await runRipgrep(plan.rgArgs, plan.cwd);

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
    // ripgrep emits paths relative to the search root (`.`), e.g. `foo.ts:12:...`.
    // Strip the leading `./` so output matches the canonical `file:line:content`
    // format used elsewhere.
    lines = lines.map(l => (l.startsWith('./') ? l.slice(2) : l));

    if (code === 1 || lines.length === 0) {
      const errorMsg = formatZeroMatchMessage(pattern, args.file_pattern, plan);
      console.error(`[searchCode] ${errorMsg.split('\n')[0]}`);
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

    const fixNotice = plan.filePatternFix ? `${plan.filePatternFix}\n\n` : '';
    return { content: fixNotice + lines.join('\n') + truncatedNotice };
  } catch (e) {
    const errorMsg = (e as Error).message;
    console.error(`[searchCode] Error:`, errorMsg);
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
}
