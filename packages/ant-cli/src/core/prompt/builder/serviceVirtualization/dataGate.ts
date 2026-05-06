/**
 * service-virtualization-data activation gate (SBS SSOT).
 *
 * The `service-virtualization-data` partial governs FAKE body realism
 * (text / number / date / id / relation fields) returned by virtualized
 * adapters. The gate combines the "virtualization is in scope" axis with
 * the body-authoring task types:
 *
 *   hasBusinessConnection × (taskType ∈ { feature, ui, design-system })
 *
 * Body-authoring task types are the ones that can plausibly emit data
 * shapes consumed by UI / FE code. Other task types (verification, error,
 * setup, test-code, doc, explain) do NOT author fake bodies and so do
 * not trigger this partial.
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
 *          one of the body-authoring types (feature / ui / design-system).
 */
export function isServiceVirtualizationDataActive(
  input: ServiceVirtualizationDataGateInput,
): boolean {
  if (input.hasBusinessConnection !== true) return false;
  return (
    input.taskType === 'feature' ||
    input.taskType === 'ui' ||
    input.taskType === 'design-system'
  );
}
