/**
 * Service Virtualization gate helpers — barrel re-export.
 *
 * Four orthogonal partials cover the SV surface (MECE):
 *   - `service-virtualization-contract` (port shape + toggle grammar)
 *   - `service-virtualization-data`     (FAKE body realism, non-image)
 *   - `service-virtualization-imagery`  (FAKE body realism, image subtype)
 *   - `service-virtualization-session`  (cross-body demo coherence over time)
 *
 * Each gate predicate is a pure function over a small input record so the
 * call sites (plan / execute / tests) share one source of truth.
 *
 * SSOT for the umbrella concept and the leaf vocabulary ("mock") split —
 * see `CLAUDE.md` / `.cursorrules` "Service Virtualization prompt SSOTs
 * (MECE)" + the `mock_real_symmetry_ssot` plan §0.
 */

export {
  isServiceVirtualizationContractActive,
  type ServiceVirtualizationContractGateInput,
} from './contractGate';

export {
  isServiceVirtualizationDataActive,
  type ServiceVirtualizationDataGateInput,
} from './dataGate';

export {
  isServiceVirtualizationImageryActive,
  type ServiceVirtualizationImageryGateInput,
} from './imageryGate';

export {
  isServiceVirtualizationSessionActive,
  isSvWorldSeedActive,
  isSvStoreLifecycleActive,
  isSvBodyLifecycleActive,
  isSvAuthFlowActive,
  type ServiceVirtualizationSessionGateInput,
} from './sessionGate';

export {
  detectHasBusinessConnection,
  detectIsGreenfield,
  buildVirtualizationSnapshot,
} from './snapshot';

export {
  type ConnectionCategory,
  type DeployFramework,
  type AnnotationMatch,
  type FrameworkAwareToggles,
  CONNECTION_ANNOTATION_RE,
  parseAnnotationLine,
  deriveToggleVar,
  frameworkTogglePrefix,
  frameworkAwareToggleVars,
  toToggleFramework,
  resolveActivation,
  anyInScanRadius,
  collectInScanRadius,
} from './connectionModel';
