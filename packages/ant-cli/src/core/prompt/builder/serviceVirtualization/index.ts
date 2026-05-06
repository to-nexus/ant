/**
 * Service Virtualization gate helpers — barrel re-export.
 *
 * Three orthogonal partials cover the SV surface (MECE):
 *   - `service-virtualization-contract` (port shape + toggle grammar)
 *   - `service-virtualization-data`     (FAKE body realism, non-image)
 *   - `service-virtualization-imagery`  (FAKE body realism, image subtype)
 *
 * Each gate predicate is a pure function over a small input record so the
 * call sites (plan / execute / tests) share one source of truth.
 *
 * SSOT for the umbrella concept and the leaf vocabulary ("mock") split —
 * see `AGENTS.md` "Service Virtualization prompt SSOTs (MECE)" + the
 * `mock_real_symmetry_ssot` plan §0.
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
  detectHasBusinessConnection,
  buildVirtualizationSnapshot,
} from './snapshot';
