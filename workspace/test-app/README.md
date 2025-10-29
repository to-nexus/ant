# test-app

Test workspace for ANT framework development and validation.

## Structure

```
test-app/
├── common/
│   ├── inputs/directives/learn/
│   └── outputs/reports/
├── {feature}/              # Created with: npm run init:feature
│   ├── inputs/
│   │   ├── sources/        # PRD, Figma links, wireframes
│   │   └── directives/     # design, code, learn, eval
│   └── outputs/
│       ├── design/         # Generated design documents
│       ├── reports/        # Execution reports
│       ├── eval/           # Evaluation reports (with --eval)
│       └── session.json    # Session history (1.4KB optimized)
└── config.json

Note: Generated code is written directly to repository (config.localPath),
      NOT to workspace/outputs/code. This enables Git workflow integration.
```

## Quick Start

```bash
# 1. Create feature
npm run init:feature test-app feature-name

# 2. Write PRD
vim workspace/test-app/feature-name/inputs/sources/prd.md

# 3. Generate design
npm run dev architect design workspace/test-app/feature-name

# 4. Generate code
npm run dev architect code workspace/test-app/feature-name

# 5. Generate code with evaluation
npm run dev architect code workspace/test-app/feature-name --eval
```

## Configuration

See `config.json` for workspace settings:
- `repoType`: local | remote
- `localPath`: Target directory for generated code
- `branchBase`: Base branch for feature branches
- `strictValidation`: Enable build/lint/test validation
- `runTests`: Run tests during validation
