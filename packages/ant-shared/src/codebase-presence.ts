/**
 * Codebase presence — SSOT predicate for "does this workspace contain a real
 * codebase?".
 *
 * A *real* codebase is defined by the presence of a recognized dependency /
 * build manifest (or a workspace marker) at the codebase root — NOT by the
 * mere existence of arbitrary files. A folder holding only `README.md` /
 * `.txt` notes is intentionally NOT a codebase.
 *
 * This module is pure (no `fs`) so it stays browser-safe and shared. The
 * filesystem walk lives in `@ant/cli`'s `detectCodebasePresence`, which feeds
 * the depth-1 entry names into {@link containsCodebaseManifest}. Both the BE
 * triage analyzer (`WorkspaceState.hasCodebase`) and the Git snapshot
 * (`GitSnapshot.hasCodebase`) resolve to this single predicate.
 */

/**
 * Dependency / build manifests + workspace markers that signal a real
 * codebase. Matched by exact filename at depth 1 of the codebase root.
 */
export const CODEBASE_MANIFEST_FILES: ReadonlySet<string> = new Set([
  // JS / TS (+ monorepo workspace marker)
  'package.json', 'pnpm-workspace.yaml',
  // Python
  'pyproject.toml', 'requirements.txt', 'setup.py', 'setup.cfg', 'Pipfile',
  // Rust
  'Cargo.toml',
  // Go (+ workspace)
  'go.mod', 'go.work',
  // JVM (Java / Kotlin / Gradle / Maven)
  'pom.xml', 'build.gradle', 'build.gradle.kts',
  'settings.gradle', 'settings.gradle.kts',
  // PHP / Ruby / Elixir / Dart
  'composer.json', 'Gemfile', 'mix.exs', 'pubspec.yaml',
]);

/**
 * Manifests whose filename varies (project name embedded). Matched by suffix.
 */
const CODEBASE_MANIFEST_SUFFIXES: readonly string[] = ['.csproj', '.sln', '.fsproj'];

/**
 * Pure predicate — does this list of depth-1 entry names contain a real
 * dependency/build manifest? Dotfiles should be filtered by the caller.
 */
export function containsCodebaseManifest(entryNames: Iterable<string>): boolean {
  for (const name of entryNames) {
    if (CODEBASE_MANIFEST_FILES.has(name)) return true;
    if (CODEBASE_MANIFEST_SUFFIXES.some(suffix => name.endsWith(suffix))) return true;
  }
  return false;
}
