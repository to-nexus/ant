# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

#### KubernetesIDEOrchestrator Integration
- **cloud-ide.routes.ts**: Replace `IDEService` (Docker) with `IDEOrchestratorPort` interface
- **cloud-ide.routes.ts**: Add `host` field to responses for K8s Pod IP support
- **cloud-ide.routes.ts**: Update `getDirectUrl()` to handle K8s mode (returns proxy URL)
- **cloud-ide.routes.ts**: Add runtime info in debug response (`ideRuntime: kubernetes/docker`)
- **RouteConfigurator.ts**: Use `InfrastructureFactory.getIDEOrchestrator()` instead of `deps.ideService`
- **KubernetesIDEOrchestrator.ts**: Add `readServiceAccountCACert()` for in-cluster TLS verification
- **KubernetesIDEOrchestrator.ts**: Add `getPodIfExists()` helper method
- **KubernetesIDEOrchestrator.ts**: Add `waitForPodDeletion()` for graceful pod recreation
- **KubernetesIDEOrchestrator.ts**: Add `createInstanceResult()` for reusing existing pods
- **KubernetesIDEOrchestrator.ts**: Add `deletionTimestamp` to `K8sMetadata` type

### Changed

#### InfrastructureFactory
- Move dependency check inside else block - K8s mode doesn't require `PortManager`/`PortRegistry`

#### KubernetesIDEOrchestrator
- Rewrite `k8sRequest()` to use `https` module with ServiceAccount CA certificate (instead of `fetch`)
- Handle Pod lifecycle states:
  - `Running`: reuse existing pod
  - `Terminating` (deletionTimestamp set): wait for deletion then recreate
  - `Failed`/`Pending`: delete and recreate
- Handle Service 409 Conflict error (already exists) gracefully

### Fixed

- **KubernetesIDEOrchestrator**: Fix TLS certificate verification error (`unable to verify the first certificate`) by using ServiceAccount CA cert from `/var/run/secrets/kubernetes.io/serviceaccount/ca.crt`
- **KubernetesIDEOrchestrator**: Fix 409 Conflict error when Pod is being deleted by waiting for deletion completion

---

## Comparison: `cloud-scalability` → `ci/modify-cloud-build`

| File | Changes |
|------|---------|
| `cloud-ide.routes.ts` | `IDEService` → `IDEOrchestratorPort`, add `host` field, K8s proxy URL support |
| `RouteConfigurator.ts` | Use `getIDEOrchestrator()` from factory |
| `InfrastructureFactory.ts` | K8s mode skips PortManager dependency check |
| `KubernetesIDEOrchestrator.ts` | +181 lines: TLS fix, Pod lifecycle handling, helper methods |
