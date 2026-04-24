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
        // git-world API surface lockdown — see
        //   docs/architecture/24-git-operations.md §0
        //   .claude/skills/update-git-world/SKILL.md
        // Boundary rules are expressed in the `files:` override below so
        // they apply to every file except git-world's own implementation.
      ],
    }],

    // The per-file overrides block at the bottom carries the git-world
    // boundary rules (error level). This placeholder disables the unused
    // legacy rule so it can't be reinstated by accident.
    'no-restricted-modules': 'off',

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
      // git-world surface lockdown — files OUTSIDE the git-world slice
      // must not reach for private infrastructure paths. See
      //   docs/architecture/24-git-operations.md §0
      //   .claude/skills/update-git-world/SKILL.md
      // Level: `error`. `warn` was used during greenfield migration and
      // promoted at Phase 7 cutover.
      files: ['src/**/*.{ts,tsx}'],
      excludedFiles: [
        'src/domain/git-world/**',
        'src/presentation/components/common/async/primitives/**',
      ],
      rules: {
        'no-restricted-imports': ['error', {
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
