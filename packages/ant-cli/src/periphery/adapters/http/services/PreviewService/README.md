# PreviewService Module

Dev-server management service. Two structures coexist here:

1. **Collaborators** — detection/validation/spawn/install concerns extracted
   into `detectors/`, `validators/`, `managers/`, `utils/` (each a focused
   class or function module the service composes in its constructor).
2. **The service itself** — an **inheritance chain of domain layers**, one
   file per layer, because the preview test suites construct the service and
   reach protected fields / prototype methods directly (spawn retry, pid
   tracking, local-first self-heal): methods must stay prototype methods
   reading `this.*` at call time, so the split is by class layer, not by
   extracted functions over a ctx.

## 📂 Directory Structure

```
PreviewService/
├── PreviewService.ts          # Top of the chain: idle check, owned-identity
│                              #   reaping, project/feature cleanup, shutdown
├── PreviewLocalLayer.ts       # Local-first: getLocalPreview / ensureRunning /
│                              #   readiness waits / rehydrate coalescing
├── PreviewStartLayer.ts       # startPreview (the 9-step start sequence)
├── PreviewSpawnLayer.ts       # validation-failure surfacing + port-conflict retry
├── PreviewStopLayer.ts        # stopPreview — the ONE stop authority
├── PreviewExitLayer.ts        # process-exit handling + early-exit diagnostics
├── PreviewQueryLayer.ts       # status/log reads + owned-record helpers
├── PreviewServiceCore.ts      # state maps, collaborator wiring, phase/broadcast/
│                              #   log plumbing, URL identity (slug SSOT)
├── index.ts                   # Public exports
├── types.ts                   # Type definitions
├── utils/                     # serverKeyUtils, previewLabel, projectFacts,
│                              #   HealthChecker, connectionResolve, connectionDir
├── detectors/                 # ProjectStructure/Profile/Package/Issue/Runtime,
│                              #   ConnectionDetector/ (+ envFileWriter)
├── validators/                # ProjectValidator + React/Next/Vue validators
└── managers/                  # ProcessSpawner, DependencyInstaller,
    │                          #   InfrastructureManager, ProvisioningManager,
    └──                        #   LogManager, envAssembly, previewManifest, mockToggles
```

Chain order (base → top): Core → Query → Exit → Stop → Spawn → Start → Local →
`PreviewService`. TypeScript enforces the order — a layer can only call methods
declared at or below itself, so the chain doubles as a dependency DAG.

`startPreview` (in `PreviewStartLayer`) is still one ~750-line sequential
method; decomposing its steps is a behavioral redesign (the steps share the
pod-local state maps), deliberately out of scope for the mechanical split.

## Known seams

- URL/slug identity (`assignPackageUrlIdentity` in `PreviewServiceCore`) is
  the slug SSOT — see `docs/internals/22-preview-system.md`.
- `summarizePreviewSpawnOutcome` is defined in `PreviewStartLayer` and
  re-exported from `PreviewService.ts` (tests import it from that path).
