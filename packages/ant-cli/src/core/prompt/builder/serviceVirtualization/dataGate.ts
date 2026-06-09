/**
 * service-virtualization-data activation gate (SBS SSOT).
 *
 * The `service-virtualization-data` partial governs FAKE body realism
 * (text / number / date / id / relation fields) returned by virtualized
 * adapters. The gate combines the "virtualization is in scope" axis with
 * the body-authoring task types:
 *
 *   hasBusinessConnection × (taskType ∈ { feature, ui })
 *
 * Body-authoring task types are the ones that emit / render data shapes
 * consumed by UI / FE code. `design-system` is excluded — token / shared-
 * primitive infrastructure authors no fake response body (it is presentational
 * and data-shape-agnostic; placeholder imagery is covered by the imagery
 * partial). Other task types (verification, error, setup, test-code, doc,
 * explain) likewise do NOT author fake bodies and so do not trigger this partial.
 */

export interface ServiceVirtualizationDataGateInput {
  /** True when the codebase declares at least one `business` connection. */
  hasBusinessConnection: boolean;
  /** Task type at the call site (`currentTask.type` for execute, plan-side
   *  task type for plan). Callers pass the resolved string. */
  taskType: string | undefined;
}

/**
 * @returns `true` iff `hasBusinessConnection === true` AND `taskType` is
 *          one of the body-authoring types (feature / ui).
 */
export function isServiceVirtualizationDataActive(
  input: ServiceVirtualizationDataGateInput,
): boolean {
  if (input.hasBusinessConnection !== true) return false;
  return input.taskType === 'feature' || input.taskType === 'ui';
}
