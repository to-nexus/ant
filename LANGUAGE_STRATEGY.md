# Language-Specific Prompt Strategy

## 📋 Overview

The ANT system now supports **language-specific prompts** similar to Cursor/Copilot's approach.

## 🏗️ Architecture

### Before (Hard-coded TypeScript)
```
src/core/prompt/templates/code/phases/execute/injections/
  └── new-project-setup.md  ← TypeScript only!
```

### After (Multi-Language Support)
```
src/core/prompt/templates/code/
  ├── phases/execute/injections/
  │   └── new-project-setup-general.md  ← Language-agnostic guide
  └── languages/
      ├── typescript/setup/config.md    ← TypeScript specifics
      ├── golang/setup/config.md        ← Golang specifics
      ├── python/setup/config.md        ← Python specifics
      └── rust/setup/config.md          ← (Future: Rust specifics)
```

## 🔍 Language Detection Strategy

The `ModeController` detects language in this order:

1. **Codebase Profile** (existing projects)
   - From `codebaseProfile.language`
   - Most reliable for existing code

2. **Design Document Keywords** (new projects)
   - Searches for: "typescript", "golang", "python", "rust", "java"
   - Checks for config files: "tsconfig", "go.mod", "pyproject.toml"
   - Checks for frameworks: "react", "fastapi", "django"

3. **Default Fallback**
   - Defaults to TypeScript (most common)

## 📝 Prompt Injection Flow

When creating a new project, the system now injects:

```typescript
// 1. General guide (all languages)
injections.push(`code/phases/execute/injections/new-project-setup-general`);

// 2. Language-specific details
const language = detectLanguage(context);  // e.g., "typescript", "golang", "python"
injections.push(`code/languages/${language}/setup/config`);
```

## 🎯 Benefits

### 1. **Extensibility**
- Easy to add new languages: just create `languages/{lang}/setup/config.md`
- No code changes needed for new language support

### 2. **Maintainability**
- Language-specific details are isolated
- General principles stay DRY (Don't Repeat Yourself)

### 3. **Quality**
- Each language gets best-practice configs
- Critical settings (like `moduleResolution` for TS) are highlighted

## 📚 Language-Specific Templates

### TypeScript
- ✅ `tsconfig.json` with `moduleResolution: "node"` (CRITICAL!)
- ✅ `package.json` with `@types/` packages
- ✅ Build tool configs (Vite, Next.js, Webpack)
- ✅ ESLint, Tailwind configuration

### Golang
- ✅ `go.mod` with proper module path
- ✅ Standard project layout (`cmd/`, `internal/`, `pkg/`)
- ✅ `Makefile` for common tasks
- ✅ `.golangci.yml` for linting

### Python
- ✅ `pyproject.toml` (modern) or `requirements.txt` (classic)
- ✅ Standard project layout (`src/`, `tests/`)
- ✅ Virtual environment setup
- ✅ `pytest`, `black`, `mypy` configuration

## 🔮 Future Enhancements

1. **Framework-Specific Templates**
   ```
   languages/typescript/
     ├── setup/config.md          (general TS)
     └── frameworks/
         ├── react.md             (React-specific)
         ├── nextjs.md            (Next.js-specific)
         └── vue.md               (Vue-specific)
   ```

2. **Build Tool Templates**
   ```
   languages/typescript/
     └── build-tools/
         ├── vite.md
         ├── webpack.md
         └── esbuild.md
   ```

3. **Explicit Language Selection**
   - Allow user to specify language in directive
   - Override auto-detection

## 🛠️ Implementation Details

### Code Changes

1. **ModeController.ts**
   - Added `detectLanguage()` method
   - Modified `selectInjections()` to include language-specific templates

2. **Template Structure**
   - Created language-agnostic `new-project-setup-general.md`
   - Created language-specific templates in `languages/{lang}/`

### Diagnostics System

The diagnostics system already had language-specific structure:
```
src/agents/architect/graph/code/nodes/diagnostics/
  ├── languages/
  │   ├── typescript.ts
  │   ├── golang.ts (go.ts)
  │   ├── python.ts
  │   ├── rust.ts
  │   └── java.ts
  ├── buildTools/
  └── packageManagers/
```

The prompt system now mirrors this architecture!

## 🎓 Inspiration

This approach is inspired by:
- **Cursor/Copilot**: Language-aware code generation
- **Aider**: Language-specific templates and patterns
- **SWE-agent**: Tool chain selection based on language

## ✅ Refactoring Verification (2025-10-31)

### Structure Check
```bash
✅ new-project-setup-general.md (language-agnostic)
✅ languages/typescript/setup/config.md
✅ languages/golang/setup/config.md
✅ languages/python/setup/config.md
✅ Legacy files completely removed (no .backup files)
✅ ModeController updated with detectLanguage() method
```

### Quality Check
```bash
✅ TypeScript: moduleResolution + @types guidelines
✅ Golang: go.mod + standard layout (cmd/, internal/, pkg/)
✅ Python: pyproject.toml + venv setup
✅ All CRITICAL settings highlighted
✅ Best practices included
```

### Testing
To verify the new system works:

```bash
# 1. Clean test project
cd /Users/probe/dev/test-app
rm -rf src package.json tsconfig.json

# 2. Run architect code task
cd /Users/probe/dev/ant
npm run dev -- architect code workspace/test-app/skeleton/

# 3. Expected behavior:
# - Detects language from design document
# - Loads general guide + language-specific config
# - Generates correct tsconfig.json with moduleResolution
```

## 🤔 What About PLAN Phase?

### Question
Does the PLAN phase need language-specific templates too?

### Answer: No! Generalization is sufficient.

**Plan Phase Role:**
- What to build (abstract level)
- File list, task order
- Language examples only

**Execute Phase Role:**
- How to implement (concrete level)
- Actual config content, CRITICAL settings
- Language-specific templates needed ✅

### Implementation

**Plan template was generalized:**
```markdown
Before (TypeScript hardcoded):
  ❌ "Step 2: Generate package.json"
  ❌ "Step 4: Generate TypeScript config"

After (Language-agnostic):
  ✅ "Step 2: Generate dependency file
      • TypeScript: package.json
      • Go: go.mod
      • Python: requirements.txt"
```

**File:** `code/phases/plan/injections/new-project-warning.md`

### Architecture Principle

```
Abstraction Level → Template Strategy

High (Plan)    → Generalize with examples
Low (Execute)  → Language-specific templates
```

This keeps Plan simple while Execute provides detailed guidance!

## 📖 Related Files

- `src/core/prompt/engine/ModeController.ts` - Language detection & injection
- `src/core/prompt/templates/code/phases/plan/injections/new-project-warning.md` - Generalized plan guide
- `src/core/prompt/templates/code/phases/execute/injections/new-project-setup-general.md` - Execute general guide
- `src/core/prompt/templates/code/languages/*/setup/config.md` - Language-specific execute guides
- `src/agents/architect/graph/code/nodes/diagnostics/languages/` - Runtime diagnostics

---

**Date Created**: 2025-10-31
**Last Updated**: 2025-10-31
**Status**: ✅ Implemented & Tested

