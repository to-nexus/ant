# test-app

## Workspace Structure

```
test-app/
├── common/
│   ├── inputs/
│   │   └── directives/learn/
│   └── outputs/
│       ├── memory/
│       └── reports/
├── {feature}/              # Add features with: npm run init:feature
│   ├── inputs/
│   │   ├── sources/
│   │   └── directives/
│   └── outputs/
└── config.json
```

## Quick Start

1. Create a feature:
```bash
npm run init:feature test-app ui-1.0.0
```

2. Add PRD:
```bash
# Edit workspace/test-app/ui-1.0.0/inputs/sources/prd.md
```

3. Generate design:
```bash
npm run dev architect design workspace/test-app/ui-1.0.0
```

4. Generate code:
```bash
npm run dev architect code workspace/test-app/ui-1.0.0
```
