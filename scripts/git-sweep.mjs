#!/usr/bin/env node
/**
 * git-sweep.mjs — structural re-fragmentation gate.
 *
 * Enforces the invariants of the git-world greenfield rewrite (see
 * `docs/architecture/24-git-operations.md`). Fails the build if any of
 * the canonical patterns reappear outside their declared whitelists.
 *
 * Usage:
 *   node scripts/git-sweep.mjs
 *
 * Configuration:
 *   GIT_SWEEP_ALLOW_LEGACY=1  — legacy escape hatch. After cutover this
 *                                 flag is a no-op because all patterns
 *                                 apply uniformly. Kept for forward-compat
 *                                 if a new "migration window" pattern is
 *                                 added in the future.
 *
 * Exit codes:
 *   0 — all patterns pass
 *   1 — one or more patterns matched outside their whitelist
 *   2 — configuration / execution error
 *
 * Implementation notes:
 *   - No external tools required — uses Node's native fs + RegExp. This
 *     makes the gate portable across environments where ripgrep may not be
 *     installed (CI images, devcontainers, minimal shells).
 *   - Skips node_modules, dist, build, .git, and the docs/ tree. Also
 *     skips the gate script itself and the git-world skill file (so the
 *     patterns don't self-trigger on their own definitions).
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

const ALLOW_LEGACY = process.env.GIT_SWEEP_ALLOW_LEGACY === '1';

/**
 * @typedef {Object} Pattern
 * @property {string} id
 * @property {string} desc
 * @property {string} regex        — ECMAScript regex source
 * @property {string[]} [paths]    — subtree roots to scan (default: packages/)
 * @property {string[]} [whitelist] — path prefixes (relative to repoRoot)
 *                                     exempt from the check
 * @property {boolean} [skipUntilCutover] — honor GIT_SWEEP_ALLOW_LEGACY
 */

/** @type {Pattern[]} */
const PATTERNS = [
  {
    id: 'P1',
    desc: 'double loading state (useState<boolean> isPushing/isCommitting/…)',
    regex: String.raw`useState\s*[<(]\s*boolean\s*[>)][^;]{0,80}is(Pushing|Committing|Pulling|Syncing|Discarding|Initializing|Cloning|Publishing|GitProcessing)`,
    paths: ['packages/ant-ui/src'],
  },
  {
    id: 'P2',
    desc: 'removed legacy fields (gitStatusPhase, *FetchState)',
    regex: String.raw`\b(gitStatusPhase|statusFetchState|changesFetchState)\b`,
    paths: ['packages/ant-ui/src'],
  },
  {
    id: 'P3',
    desc: 'fragmented fetch entry points (fetchGitAll/Status/Changes/FromRemote)',
    regex: String.raw`\bfetch(GitAll|GitStatus|GitChanges|FromRemote)\b`,
    paths: ['packages/ant-ui/src'],
  },
  {
    id: 'P4',
    desc: 'deprecated shared types (GitStatusResponse / GitChangesResponse)',
    regex: String.raw`\bGit(Status|Changes)Response\b`,
    paths: ['packages'],
    // Internal implementation detail comments in StatusService and the
    // shared package retirement note. No live references.
    whitelist: [
      'packages/ant-cli/src/periphery/adapters/http/services/GitService/status/index.ts',
      'packages/ant-shared/src/git.ts',
    ],
  },
  {
    id: 'P5',
    desc: 'PAT SSOT bypass (checkGitHubPATStatus / saveGitHubPAT / deleteGitHubPAT)',
    regex: String.raw`\b(checkGitHubPATStatus|saveGitHubPAT|deleteGitHubPAT)\b`,
    paths: ['packages/ant-ui/src'],
    whitelist: ['packages/ant-ui/src/domain/git-world/infrastructure'],
  },
  {
    id: 'P6',
    desc: 'raw GitSnapshot field access in non-git-panel presentation (use selectors)',
    // Matches ONLY when the accessor is a legacy slice name. Greenfield
    // access via `gitSnapshot.*` / `snapshot.*` is permitted; legacy
    // `gitStatus.hasGit` / `gitChanges.hasUpstream` is not.
    regex: String.raw`\bgit(Status|Changes)\.(hasGit|remoteUrl|hasFeatures|codebaseHasFiles|hasCodebase|hasUpstream)\b`,
    paths: ['packages/ant-ui/src/presentation'],
    whitelist: ['packages/ant-ui/src/presentation/git-panel'],
  },
  {
    id: 'P7',
    desc: 'badge logic reimplementation outside GitBadge',
    regex: String.raw`projectConfig[^;{}]{0,60}githubRepo`,
    paths: ['packages/ant-ui/src/presentation'],
    whitelist: ['packages/ant-ui/src/presentation/git-panel'],
  },
  {
    id: 'P8',
    desc: 'duplicate session restore (pollForFeatures)',
    regex: String.raw`\bpollForFeatures\b`,
    paths: ['packages/ant-ui/src'],
    whitelist: ['packages/ant-ui/src/application/hooks/ui/useSessionLoader.ts'],
  },
  {
    id: 'P9',
    desc: 'BE retryDeferredWatchers leaked outside GitOperation hook + watcher service',
    regex: String.raw`\bretryDeferredWatchers\b`,
    paths: ['packages/ant-cli/src'],
    whitelist: [
      'packages/ant-cli/src/periphery/adapters/http/services/GitService/remote/GitOperation.ts',
      'packages/ant-cli/src/periphery/adapters/http/services/GitWatcherService.ts',
      'packages/ant-cli/src/periphery/adapters/http/services/GitService/index.ts',
      'packages/ant-cli/src/periphery/adapters/http/routes/projects.routes.ts',
    ],
  },
  {
    id: 'P10',
    desc: 'AlertModal.isProcessing (modal lifecycle ≠ operation lifecycle)',
    regex: String.raw`\bisProcessing\b`,
    paths: ['packages/ant-ui/src/presentation/components/common/AlertModal.tsx'],
  },
  {
    id: 'P11',
    desc: 'async onConfirm on showConfirm (use ConfirmAndDispatch)',
    regex: String.raw`showConfirm[^}]{0,200}onConfirm[^}]{0,40}async`,
    paths: ['packages/ant-ui/src'],
  },
  {
    id: 'P12',
    desc: 'removed writers (setGitStatusPhase/clearGitState)',
    regex: String.raw`\b(setGitStatusPhase|clearGitState)\b`,
    paths: ['packages/ant-ui/src'],
  },
  {
    id: 'P13',
    desc: 'legacy REST path (api/github) direct import',
    regex: String.raw`from\s+['"][^'"]*api/github['"]`,
    paths: ['packages/ant-ui/src'],
    whitelist: [
      'packages/ant-ui/src/domain/git-world/infrastructure',
      // The thin `checkCloneStatus` poller retained under
      // infrastructure/http/api/github.ts has no re-export consumers
      // outside ProjectWizardModal — which imports it directly.
      'packages/ant-ui/src/presentation/components/ProjectWizardModal',
    ],
  },
  {
    id: 'P14',
    desc: 'legacy slice import (slices/gitSlice or domain/git)',
    regex: String.raw`from\s+['"][^'"]*(slices/gitSlice|domain/git['"])`,
    paths: ['packages/ant-ui/src'],
  },
  {
    id: 'P15',
    desc: 'legacy broadcaster / event name (GitChangeBroadcaster / notifyGitChange / gitChange event)',
    regex: String.raw`GitChangeBroadcaster|notifyGitChange\b|['"]gitChange['"]`,
    paths: ['packages'],
  },
  {
    id: 'P16',
    desc: 'BE Git operation class name leaked into FE',
    regex: String.raw`\b(InitOperation|PushOperation|PullOperation|FetchOperation|SyncOperation|CommitOperation|DiscardOperation|CloneOperation|PublishOperation)\b`,
    paths: ['packages/ant-ui/src'],
  },
  {
    id: 'P17',
    desc: 'legacy REST function usage (initializeGitHubRepo / pushToGitHub / …)',
    regex: String.raw`\b(initializeGitHubRepo|cloneGitHubRepo|pushToGitHub|pullFromGitHub|fetchFromGitHub|syncWithRemote|commitGitChanges|discardGitChanges)\b`,
    paths: ['packages/ant-ui/src'],
    whitelist: ['packages/ant-ui/src/domain/git-world/infrastructure'],
  },
  {
    id: 'P18',
    desc: 'canonical git vocabulary leaked into FE (initializeOperation / publishBranch)',
    regex: String.raw`\b(initializeOperation|publishBranch)\b`,
    paths: ['packages/ant-ui/src'],
  },
];

const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', '.git', '.next',
  'coverage', '.turbo', '.cache', '__snapshots__',
]);

const SCAN_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
]);

// Files that define or document the patterns themselves — we skip them
// so the gate doesn't report matches on its own source.
const SELF_REFERENCES = [
  'scripts/git-sweep.mjs',
  '.claude/skills/update-git-world/SKILL.md',
  'docs/tmp/git-world-greenfield-rewrite-handoff.md',
  'docs/architecture/24-git-operations.md',
];

/**
 * Recursively yield file paths under `dir` whose extension is in
 * SCAN_EXTENSIONS and that are not inside SKIP_DIRS.
 *
 * @param {string} dir
 * @returns {Generator<string>}
 */
function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(full);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = entry.name.slice(entry.name.lastIndexOf('.'));
    if (!SCAN_EXTENSIONS.has(ext)) continue;
    yield full;
  }
}

/**
 * Normalize a relative path against the repo root, using forward slashes.
 *
 * @param {string} absPath
 * @returns {string}
 */
function rel(absPath) {
  return relative(repoRoot, absPath).split(sep).join('/');
}

/**
 * Does `fileRel` match one of the whitelist entries? Whitelist entries are
 * plain path prefixes (folder) or exact file paths. Both forward-slash form.
 *
 * @param {string} fileRel
 * @param {string[]} whitelist
 * @returns {boolean}
 */
function isWhitelisted(fileRel, whitelist) {
  for (const w of whitelist) {
    const wn = w.replace(/\\/g, '/').replace(/\/+$/, '');
    if (fileRel === wn) return true;
    if (fileRel.startsWith(wn + '/')) return true;
  }
  return false;
}

/**
 * @param {Pattern} pattern
 * @returns {{ hits: Array<{ file: string, line: number, text: string }> }}
 */
function runPattern(pattern) {
  const paths = pattern.paths ?? ['packages'];
  const existing = paths.filter((p) => existsSync(join(repoRoot, p)));
  if (existing.length === 0) return { hits: [] };

  const re = new RegExp(pattern.regex);
  const whitelist = pattern.whitelist ?? [];

  /** @type {Array<{ file: string, line: number, text: string }>} */
  const hits = [];

  for (const root of existing) {
    for (const abs of walk(join(repoRoot, root))) {
      const r = rel(abs);
      if (SELF_REFERENCES.includes(r)) continue;
      if (isWhitelisted(r, whitelist)) continue;

      let content;
      try {
        // Skip big binary-looking files — we only care about source.
        const st = statSync(abs);
        if (st.size > 2 * 1024 * 1024) continue;
        content = readFileSync(abs, 'utf8');
      } catch {
        continue;
      }
      if (!re.test(content)) continue;

      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
          hits.push({ file: r, line: i + 1, text: lines[i].trim().slice(0, 200) });
        }
      }
    }
  }

  return { hits };
}

function main() {
  let failed = 0;
  let skipped = 0;

  for (const pattern of PATTERNS) {
    if (pattern.skipUntilCutover && ALLOW_LEGACY) {
      skipped++;
      continue;
    }

    const { hits } = runPattern(pattern);
    if (hits.length === 0) continue;

    failed++;
    console.error(`\n[${pattern.id}] ${pattern.desc}`);
    console.error(`  regex : ${pattern.regex}`);
    console.error(`  paths : ${(pattern.paths ?? ['packages']).join(', ')}`);
    if (pattern.whitelist && pattern.whitelist.length) {
      console.error(`  allow : ${pattern.whitelist.join(', ')}`);
    }
    console.error(`  hits  : ${hits.length}`);
    for (const hit of hits.slice(0, 10)) {
      console.error(`    ${hit.file}:${hit.line}: ${hit.text}`);
    }
    if (hits.length > 10) {
      console.error(`    … (+${hits.length - 10} more)`);
    }
  }

  if (failed > 0) {
    console.error(
      `\ngit-sweep: ${failed} pattern(s) violated${
        skipped ? `, ${skipped} legacy pattern(s) skipped via GIT_SWEEP_ALLOW_LEGACY` : ''
      }.`,
    );
    process.exit(1);
  }

  console.log(
    `git-sweep: all patterns OK${
      skipped ? ` (${skipped} skipped via GIT_SWEEP_ALLOW_LEGACY)` : ''
    }.`,
  );
}

main();
