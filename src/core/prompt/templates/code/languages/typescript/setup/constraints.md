## TypeScript/JavaScript Setup Task Constraints

⛔ **CRITICAL: This is a SETUP task - Configuration files ONLY** ⛔

This is PHASE 1 of a multi-phase process. You must generate ONLY configuration files.
Application code will be generated in PHASE 2 (next task).

### ✅ ALLOWED FILES (Configuration & Setup):

**Package Management:**
- package.json (with ALL dependencies - don't defer anything!)
- package-lock.json, yarn.lock, pnpm-lock.yaml (if needed)

**TypeScript Configuration:**
- tsconfig.json
- tsconfig.*.json (tsconfig.node.json, tsconfig.app.json, etc.)

**Build Tool Configuration:**
- vite.config.ts, vite.config.js
- webpack.config.js, webpack.config.ts
- rollup.config.js, rollup.config.ts
- esbuild.config.js
- turbo.json (for monorepo)

**Styling Configuration:**
- tailwind.config.js, tailwind.config.ts
- postcss.config.js, postcss.config.cjs
- next.config.js, next.config.mjs (for Next.js)

**Linting & Formatting:**
- .eslintrc.json, .eslintrc.js, .eslintrc.cjs
  ⚠️  CRITICAL: MUST include `ignorePatterns: ["dist", "build", "node_modules", "*.config.*"]`
  ⚠️  Without ignorePatterns, ESLint will check build artifacts and cause errors!
- .eslintignore (alternative to ignorePatterns)
- .prettierrc, .prettierrc.json
- .editorconfig

**Project Files:**
- .gitignore
- .env.example, .env.local.example
- README.md, LICENSE
- .nvmrc, .node-version

**Web Entry Points:**
- index.html (ONLY the HTML entry point, NO script content)

**Docker (if needed):**
- Dockerfile, .dockerignore
- docker-compose.yml

### ❌ FORBIDDEN FILES (Application Code):

**Source Directories - DO NOT CREATE:**
- src/* (ALL files)
- app/* (ALL files - Next.js app directory)
- pages/* (ALL files - Next.js pages)
- lib/* (ALL files - library code)
- components/* (ALL files)
- hooks/* (ALL files)
- utils/* (ALL files)
- services/* (ALL files)
- api/* (ALL files)
- styles/* (ALL files except if it's just config)

**Application Files - DO NOT CREATE:**
- main.tsx, main.ts, main.jsx, main.js
- index.tsx, index.ts (application entry)
- App.tsx, App.ts, App.jsx, App.js
- server.ts, server.js
- Any .tsx, .jsx, .ts, .js files (except *.config.*)

### ⚠️  VALIDATION BEFORE OUTPUT:

Check EVERY file path in your output:
```
For each file:
  if path.startsWith('src/'):     DELETE IT
  if path.startsWith('app/'):     DELETE IT  
  if path.startsWith('pages/'):   DELETE IT
  if path.startsWith('lib/'):     DELETE IT
  if path.startsWith('components/'): DELETE IT
  if path.endsWith('.tsx|.jsx') and not path.includes('config'): DELETE IT
```

### 📌 WHY THIS MATTERS:

1. **Dependencies first**: package.json must be created and `npm install` must run BEFORE any code
2. **Config validation**: TypeScript/build configs must be validated BEFORE writing code
3. **Clean separation**: Setup errors don't pollute code generation
4. **Next task ready**: After this task, the environment is ready for code generation

### 🎯 YOUR RESPONSIBILITY:

Generate ONLY configuration and setup files listed in the ALLOWED section.
The next Feature task will generate ALL application code.

⛔ **FINAL WARNING: Generating src/* files will cause validation failure!** ⛔

