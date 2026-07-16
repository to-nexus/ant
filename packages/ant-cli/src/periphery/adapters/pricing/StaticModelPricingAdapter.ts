import { buildModelPricingTable, type ModelPricingEntry } from '@ant/shared';
import type { ModelPricingPort } from '../../../core/ports/modelPricing';

/**
 * Default {@link ModelPricingPort} — serves the compiled-in list prices from the
 * `MODEL_REGISTRY` SSOT (via `buildModelPricingTable`). Prices are static
 * (provider public list), so this is synchronous under the hood; the async
 * signature is the port's forward contract for a future remote-fetch adapter.
 */
export class StaticModelPricingAdapter implements ModelPricingPort {
  async listModelRates(): Promise<ModelPricingEntry[]> {
    return buildModelPricingTable();
  }
}
