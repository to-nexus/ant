module.exports = {
  root: true,
  env: {
    browser: true,
    es2021: true,
    node: true
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended'
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true
    }
  },
  plugins: [
    '@typescript-eslint',
    'react',
    'react-hooks'
  ],
  ignorePatterns: [
    'dist',
    'build',
    'node_modules',
    '*.config.*'
  ],
  rules: {
    'react/react-in-jsx-scope': 'off',
    'react/prop-types': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'warn',

    // ── Async UI Policy (docs/architecture/ui-async-policy.md) ──────────
    //
    // Loader2 is the only lucide spinner allowed in the codebase, and it
    // must only be imported by the Spinner primitive. All other code
    // imports Spinner from @/presentation/components/common/async.
    'no-restricted-imports': ['error', {
      paths: [
        {
          name: 'lucide-react',
          importNames: ['Loader2'],
          message:
            'Use <Spinner> from @/presentation/components/common/async. '
            + 'Only src/presentation/components/common/async/primitives/ may import Loader2.',
        },
      ],
      patterns: [
        {
          group: ['**/application/hooks/ui/useConfigLoader*'],
          message:
            'useConfigLoader was removed as part of the Async UI Policy. '
            + 'Read projectConfig directly from the slice with useAsyncResource.',
        },
        // ── git-world API surface lockdown ──────────────────────────────
        // See docs/architecture/24-git-operations.md §0 and
        // .claude/skills/update-git-world/SKILL.md.
        //
        // These rules are active at WARN level during the greenfield
        // migration window and become ERROR at cutover (Phase 7) once the
        // legacy gitSlice / api/github imports have been removed. A `warn`
        // level surfaces the contract to new code without breaking the
        // existing pre-cutover tree.
      ],
    }],

    // git-world enforcement — surface violations early. The plan doc calls
    // these "error" at cutover; we keep them "warn" while the legacy slice
    // is still present in the tree. Flip to "error" in Phase 7.
    'no-restricted-modules': 'off',

    // Enforce: no external imports from git-world/infrastructure or the
    // deprecated api/github path.
    //
    // NOTE: The default 'no-restricted-imports' above owns the lucide rule,
    // so we express the git-world boundary via a second rule activated on
    // files outside git-world/** (via overrides below).

    // `animate-spin` / `animate-pulse` are treated as private CSS hooks of
    // the Spinner / Skeleton primitives. Domain indicators use the dedicated
    // keyframes `animate-cog-spin` / `animate-status-pulse` (see
    // tailwind.config.js). The JSX literal match below catches the common
    // `className="… animate-spin …"` pattern; template strings and clsx
    // arguments are covered by the CI grep guard in package.json.
    'no-restricted-syntax': ['error', {
      selector:
        "JSXAttribute[name.name='className'] > Literal[value=/\\b(animate-spin|animate-pulse)\\b/]",
      message:
        'Use <Spinner>/<Skeleton> from @/presentation/components/common/async. '
        + 'For domain indicators use `animate-cog-spin` or `animate-status-pulse`.',
    }],
  },
  overrides: [
    {
      // The primitives directory is the single legal consumer of Loader2 +
      // animate-spin + animate-pulse. Everything else goes through it.
      files: [
        'src/presentation/components/common/async/primitives/**',
      ],
      rules: {
        'no-restricted-imports': 'off',
        'no-restricted-syntax': 'off',
      },
    },
    {
      // git-world surface lockdown — files OUTSIDE the git-world slice must
      // not reach for private infrastructure paths. See
      // docs/architecture/24-git-operations.md §0 and
      // .claude/skills/update-git-world/SKILL.md.
      //
      // Level: `warn` during greenfield migration, `error` at cutover.
      files: ['src/**/*.{ts,tsx}'],
      excludedFiles: [
        'src/domain/git-world/**',
        'src/presentation/components/common/async/primitives/**',
      ],
      rules: {
        'no-restricted-imports': ['warn', {
          paths: [
            {
              name: 'lucide-react',
              importNames: ['Loader2'],
              message:
                'Use <Spinner> from @/presentation/components/common/async.',
            },
          ],
          patterns: [
            {
              group: [
                '@/infrastructure/http/api/github',
                '@/infrastructure/http/api/github.*',
                '**/infrastructure/http/api/github',
                '**/infrastructure/http/api/github.*',
              ],
              message:
                'Git/PAT API must be accessed via the git-world public API '
                + '(see src/domain/git-world/index.ts). Do not import '
                + 'infrastructure/http/api/github directly.',
            },
            {
              group: [
                '@/domain/git-world/infrastructure/*',
                '**/domain/git-world/infrastructure/*',
              ],
              message:
                'git-world/infrastructure/** is private. Use the '
                + 'git-world public API at src/domain/git-world/index.ts.',
            },
            {
              group: [
                '@/domain/store/slices/gitSlice',
                '**/domain/store/slices/gitSlice',
                '@/domain/git',
                '@/domain/git/*',
              ],
              message:
                'Legacy gitSlice / domain/git is being retired. Use '
                + 'useGitSnapshot / useGitDispatch / useGitCta / useGitMenu '
                + 'from src/domain/git-world.',
            },
          ],
        }],
      },
    },
  ],
  settings: {
    react: {
      version: 'detect'
    }
  }
};
