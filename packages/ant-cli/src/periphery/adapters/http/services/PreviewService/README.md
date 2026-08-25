# PreviewService Module

**Dev-server management service — modularized structure**

## 📂 Directory Structure

```
PreviewService/
├── PreviewService.ts          # Main service (orchestrator)
├── index.ts                      # Public exports
├── types.ts                      # Type definitions
├── utils/
│   └── serverKeyUtils.ts        # Server key utilities
├── detectors/
│   └── PackageDetector.ts       # Package & framework detection
├── validators/
│   ├── ProjectValidator.ts      # Project validation orchestrator
│   ├── ReactValidator.ts        # React basename validation
│   └── VueValidator.ts          # Vue Router validation
└── managers/
    └── LogManager.ts            # Log storage & retrieval
```

## 🎯 Separation of Concerns

### **PreviewService.ts** (Main Orchestrator - ~800 lines)
- Dev-server lifecycle management
- Process management (spawn, kill, health check)
- Project structure detection (fullstack, monorepo)
- Dependency installation
- SSE integration

### **PackageDetector** (~100 lines)
- `isFrontendPackage()`: detects frontend projects
- `isBackendPackage()`: detects backend projects
- `detectFrameworkType()`: detects frameworks such as React/Vue/Next

### **ProjectValidator** (~70 lines)
- Validates the basename configuration of frontend projects
- Delegates to per-framework validators

### **ReactValidator** (~100 lines)
- Validates React Router's `<BrowserRouter basename>`
- Validates the `window.__BASENAME__` type declaration
- Provides a detailed fix guide when missing

### **VueValidator** (~70 lines)
- Validates the Vue Router `createWebHistory` basename
- Provides a detailed fix guide when missing

### **LogManager** (~50 lines)
- Log storage (max 1000 lines, FIFO)
- Log retrieval
- Log cleanup

### **serverKeyUtils** (~20 lines)
- `createServerKey()`: builds the tenantId:userId:projectId:feature format
- `parseServerKey()`: parses server keys

## 🔄 Before/After Refactoring

### Before (1 file)
```
PreviewService.ts  (1,075 lines)
```

### After (8 files)
```
PreviewService.ts       (~800 lines)  ✅ 25% reduction
+ 7 module files          (~410 lines)
────────────────────────────────────
Total:                    (~1,210 lines)
```

**The added lines are an investment in clear separation of concerns and reusability.**

## 🚀 Usage Examples

```typescript
// Before (all logic inside PreviewService)
const service = new PreviewService(portManager, portRegistry, callbacks, sseService);
const isValid = await service.validateDevServerSetup(codebasePath);

// After (same API, internals modularized)
const service = new PreviewService(portManager, portRegistry, callbacks, sseService);
const isValid = await service.validateDevServerSetup(codebasePath);  // delegates to ProjectValidator

// Individual modules can also be used directly
import { PackageDetector, ProjectValidator, LogManager } from './PreviewService';

const detector = new PackageDetector();
if (detector.isFrontendPackage(packageJson)) {
  const framework = detector.detectFrameworkType(packageJson);
  // ...
}
```

## ✅ Benefits

1. **Readability**: each file has a single responsibility (SRP)
2. **Testability**: each module can be tested independently
3. **Reusability**: `PackageDetector`, `LogManager`, etc. can be used by other services
4. **Maintainability**: modifying a specific feature only touches that file
5. **Extensibility**: adding a new framework validator is easy (e.g., `SvelteValidator`)

## 🗂️ Static sites (no build manifest)

A directory holding only `*.html` files is a first-class project here, not an
error. The rule lives in `detectors/manifest/index.ts`:

- `isStaticWebProject(m)` — true only when a static entry is the **sole**
  recognition signal. Any build manifest (even one that cannot start, like a
  `package.json` without a dev script) keeps its own ecosystem's answer, so this
  rule can never change a currently-working project's detection result.
- `staticDocRoot(dir)` — the single accessor for *which* directory to serve,
  probing `STATIC_DOC_ROOTS` (`.`, `public`, `www`, `site`, `dist`, `build`,
  `src`) in order. Shared with the deploy build-output resolver.
- `staticEntryFile(dir)` — the single accessor for *which* file `/` serves:
  `index.html` when any doc-root candidate has one (probed across ALL
  candidates first, so an index always wins); otherwise the lexicographically
  first non-dot depth-1 `*.html` (deterministic across pods/snapshots/clones —
  mtime is deliberately not used). Individual `.html` files stay reachable at
  their own URLs either way, matching how static hosts serve such directories.
  The entry is decided at detection time from directory contents — never from
  request data.

Such a project detects as `language: 'html'` / `frontend-only`, and
`ProcessSpawner.spawnStatic` runs `infrastructure/preview/static-preview-server.ts`
as an ordinary child process — so log streaming, `killTree`, health check, port
registry and port-conflict retry all apply unchanged. Nothing is installed and
nothing is written into the project directory. Serving policy (no-cache,
navigation-only fallback, dotfile refusal) is `infrastructure/static/staticApp.ts`,
the same module the deploy SPA server uses.

## 📝 Future Improvement Plans

- [ ] Extract `ProcessManager` (spawn, health check, process management)
- [ ] Extract `ProjectStructureDetector` (monorepo, fullstack detection)
- [ ] Extract `DependencyInstaller` (npm/pnpm/yarn installation)
- [ ] Unit tests for each module
- [ ] Add `SvelteValidator`, `AngularValidator`

## 🔗 Related Documentation

- [Dev Server Management Architecture](../../../../../../../../docs/internals/22-preview-system.md)
- [Preview Setup Guide](../../../../../core/prompt/templates/jobs/code/base/injections/preview-setup.md)

