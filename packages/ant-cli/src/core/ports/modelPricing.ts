import type { ModelPricingEntry } from '@ant/shared';

/**
 * Programmatic source of per-model unit prices (the "가격정보" matrix).
 *
 * A seam so pricing is fetched through ONE interface instead of each caller
 * reaching into `MODEL_REGISTRY` directly. The default {@link
 * StaticModelPricingAdapter} projects the registry SSOT; a future
 * `RemoteModelPricingAdapter` can fetch/parse live provider prices from the
 * normalized `PROVIDER_PRICING_URL` behind the same port with no call-site
 * change. Async by contract for exactly that reason.
 */
export interface ModelPricingPort {
  /** All models that carry a rate, as pricing-matrix rows (registry order). */
  listModelRates(): Promise<ModelPricingEntry[]>;
}

export type { ModelPricingEntry };
