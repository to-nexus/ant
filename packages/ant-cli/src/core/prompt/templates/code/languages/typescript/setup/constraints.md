## TypeScript/JavaScript Setup Task Constraints

⛔ **CRITICAL: Configuration files ONLY - No application code** ⛔

**Setup Task Scope:**
```
PHASE 1 (Setup):    Config files → npm install → Ready for code
PHASE 2 (Feature):  Application code → Build → Done
```

### File Categories:

**✅ CREATE (Configuration layer)**
- Package: package.json, lock files
- TypeScript: tsconfig.json, tsconfig.*.json
- Build tools: vite.config.ts, webpack.config.js, etc.
- Styling: tailwind.config.js, postcss.config.js
- Linting: .eslintrc.* (MUST include ignorePatterns), .prettierrc
- Project: .gitignore, README.md, index.html (entry point only)
- Docker: Dockerfile, docker-compose.yml (if needed)

**❌ DON'T CREATE (Application layer)**
- Source directories: src/*, app/*, pages/*, lib/*, components/*, hooks/*, utils/*
- Application files: main.ts, App.tsx, server.ts, index.tsx
- Any .tsx/.jsx/.ts/.js outside of *.config.* files

**Validation Rule:**
```
Before output, check each file:
  Application code directory? → DELETE
  Application entry/component? → DELETE
  Config file? → KEEP
```

**Critical Requirements:**
1. ESLint MUST have `ignorePatterns: ["dist", "build", "node_modules", "*.config.*"]`
2. Include ALL dependencies in package.json (don't defer to feature tasks)
3. Next task will create ALL application code - don't do it now



