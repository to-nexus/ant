/**
 * GET /models/pricing — per-model unit-price matrix endpoint + ModelPricingPort.
 *
 * Locks:
 *   - the port projects every rate-bearing registry model, with a source URL;
 *   - the route returns `{ entries, currency }` and does NOT collide with
 *     `/models/:modelId` (route order: pricing is registered first);
 *   - the `rate`-less `/models` list still omits pricing (contract intact).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import express from 'express';
import { MODEL_REGISTRY } from '@ant/shared';
import { StaticModelPricingAdapter } from '../../src/periphery/adapters/pricing/StaticModelPricingAdapter';
import { createModelsRoutes } from '../../src/periphery/adapters/http/routes/models.routes';

const ratedCount = Object.values(MODEL_REGISTRY).filter((m) => m.rate !== undefined).length;

describe('StaticModelPricingAdapter', () => {
  it('lists every rate-bearing model with a normalized source URL', async () => {
    const entries = await new StaticModelPricingAdapter().listModelRates();
    expect(entries.length).toBe(ratedCount);
    for (const e of entries) {
      expect(e.rate.input).toBeGreaterThan(0);
      expect(e.rate.output).toBeGreaterThan(0);
      expect(e.source).toMatch(/^https?:\/\//);
      expect(e.displayName.length).toBeGreaterThan(0);
    }
    // Opus is priced through the credit pipeline — must be present.
    expect(entries.some((e) => e.modelId === 'claude-opus-5')).toBe(true);
  });
});

describe('GET /models/pricing', () => {
  let server: http.Server;
  let base = '';

  beforeAll(async () => {
    const app = express();
    app.use(createModelsRoutes());
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('returns { entries, currency } — not captured by /models/:modelId', async () => {
    const res = await fetch(`${base}/models/pricing`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.currency).toBe('USD');
    expect(Array.isArray(body.entries)).toBe(true);
    expect(body.entries.length).toBe(ratedCount);
    // Would be a 404 "Model not found" if :modelId had captured "pricing".
    expect(body.error).toBeUndefined();
  });

  it('the plain /models list still omits rate (pricing lives only on /models/pricing)', async () => {
    const res = await fetch(`${base}/models`);
    const body = await res.json();
    expect(body.models.every((m: any) => m.rate === undefined)).toBe(true);
  });
});
