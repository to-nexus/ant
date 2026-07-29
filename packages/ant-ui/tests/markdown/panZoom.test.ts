import { describe, expect, it } from 'vitest';
import {
  IDENTITY,
  MAX_SCALE,
  MAX_WHEEL_PX,
  MIN_SCALE,
  centerAtScale,
  clampScale,
  fitToViewport,
  panBy,
  parseSvgIntrinsicSize,
  wheelFactor,
  zoomAt,
} from '../../src/presentation/components/markdown/panZoom';

describe('clampScale', () => {
  it('clamps to [MIN_SCALE, MAX_SCALE]', () => {
    expect(clampScale(0.001)).toBe(MIN_SCALE);
    expect(clampScale(100)).toBe(MAX_SCALE);
    expect(clampScale(2.5)).toBe(2.5);
  });

  it('resets NaN but clamps infinities directionally', () => {
    expect(clampScale(NaN)).toBe(1);
    expect(clampScale(Infinity)).toBe(MAX_SCALE);
    expect(clampScale(-Infinity)).toBe(MIN_SCALE);
  });
});

describe('zoomAt', () => {
  it('keeps the anchored point fixed', () => {
    const next = zoomAt(IDENTITY, 2, { x: 100, y: 50 });
    expect(next).toEqual({ scale: 2, tx: -100, ty: -50 });
  });

  it('preserves the content point under the cursor across factors and points', () => {
    const states = [IDENTITY, { scale: 0.5, tx: 30, ty: -12 }, { scale: 3, tx: -400, ty: 220 }];
    const factors = [1.1, 0.9, 2, 0.5, 1.0001];
    const points = [
      { x: 0, y: 0 },
      { x: 640, y: 360 },
      { x: 17.5, y: 903.25 },
    ];

    for (const s of states) {
      for (const factor of factors) {
        for (const p of points) {
          const n = zoomAt(s, factor, p);
          const before = { x: (p.x - s.tx) / s.scale, y: (p.y - s.ty) / s.scale };
          const after = { x: (p.x - n.tx) / n.scale, y: (p.y - n.ty) / n.scale };
          expect(after.x).toBeCloseTo(before.x, 9);
          expect(after.y).toBeCloseTo(before.y, 9);
        }
      }
    }
  });

  // Regression: deriving k from the raw `factor` instead of the clamped result makes
  // the content drift every time the user scrolls into an already-reached zoom stop.
  it('does not drift at the clamp boundaries', () => {
    const atMax = { scale: MAX_SCALE, tx: -1234, ty: 567 };
    expect(zoomAt(atMax, 2, { x: 300, y: 200 })).toEqual(atMax);

    const atMin = { scale: MIN_SCALE, tx: 88, ty: -99 };
    expect(zoomAt(atMin, 0.5, { x: 300, y: 200 })).toEqual(atMin);
  });

  it('partially applies a factor that crosses a boundary', () => {
    const next = zoomAt({ scale: MAX_SCALE / 2, tx: 0, ty: 0 }, 10, { x: 100, y: 100 });
    expect(next.scale).toBe(MAX_SCALE);
    expect(next.tx).toBeCloseTo(100 - 100 * 2, 9);
  });
});

describe('panBy', () => {
  it('is a pure translate and is scale-independent', () => {
    expect(panBy({ scale: 4, tx: 10, ty: 20 }, 5, -7)).toEqual({ scale: 4, tx: 15, ty: 13 });
    expect(panBy({ scale: 0.25, tx: 10, ty: 20 }, 5, -7)).toEqual({ scale: 0.25, tx: 15, ty: 13 });
  });
});

describe('wheelFactor', () => {
  it('zooms in on negative deltaY and out on positive', () => {
    expect(wheelFactor(-100, 0, false)).toBeGreaterThan(1);
    expect(wheelFactor(100, 0, false)).toBeLessThan(1);
    expect(wheelFactor(0, 0, false)).toBe(1);
  });

  it('normalizes deltaMode LINE to ~16x the pixel effect', () => {
    const line = wheelFactor(-1, 1, false);
    const px = wheelFactor(-16, 0, false);
    expect(line).toBeCloseTo(px, 12);
  });

  it('normalizes deltaMode PAGE to ~100x the pixel effect', () => {
    expect(wheelFactor(-1, 2, false)).toBeCloseTo(wheelFactor(-100, 0, false), 12);
  });

  it('composes exponentially', () => {
    const twice = wheelFactor(-10, 0, false) * wheelFactor(-10, 0, false);
    expect(twice).toBeCloseTo(wheelFactor(-20, 0, false), 9);
  });

  it('returns exactly to the start after in-then-out', () => {
    expect(wheelFactor(-40, 0, false) * wheelFactor(40, 0, false)).toBeCloseTo(1, 12);
  });

  it('amplifies pinch deltas relative to scroll deltas', () => {
    expect(wheelFactor(-10, 0, true)).toBeGreaterThan(wheelFactor(-10, 0, false));
  });

  // Momentum scrolling emits very large single deltas; uncapped, Math.exp underflows
  // to exactly 0 and one flick slams into a zoom stop.
  it('caps extreme deltas to a bounded positive factor', () => {
    const out = wheelFactor(100000, 0, true);
    expect(out).toBeGreaterThan(0);
    expect(out).toBe(wheelFactor(MAX_WHEEL_PX, 0, true));

    const inward = wheelFactor(-100000, 0, true);
    expect(Number.isFinite(inward)).toBe(true);
    expect(inward).toBe(wheelFactor(-MAX_WHEEL_PX, 0, true));
  });

  it('returns 1 for non-finite deltas', () => {
    expect(wheelFactor(NaN, 0, false)).toBe(1);
    expect(wheelFactor(Infinity, 0, false)).toBe(1);
  });
});

describe('centerAtScale', () => {
  it('centers content within the viewport', () => {
    expect(centerAtScale({ width: 400, height: 200 }, { width: 800, height: 600 }, 1)).toEqual({
      scale: 1,
      tx: 200,
      ty: 200,
    });
  });

  it('yields negative offsets when scaled content exceeds the viewport', () => {
    const s = centerAtScale({ width: 1000, height: 1000 }, { width: 800, height: 600 }, 1);
    expect(s.tx).toBeLessThan(0);
    expect(s.ty).toBeLessThan(0);
  });
});

describe('fitToViewport', () => {
  it('scales a wide diagram down to the padded viewport and centers it', () => {
    const fit = fitToViewport({ width: 2000, height: 400 }, { width: 800, height: 600 });
    expect(fit.scale).toBeCloseTo(736 / 2000, 9);
    expect(fit.tx).toBeCloseTo((800 - 2000 * fit.scale) / 2, 9);
  });

  it('is bounded by the tighter axis', () => {
    const fit = fitToViewport({ width: 400, height: 4000 }, { width: 800, height: 600 });
    expect(fit.scale).toBeCloseTo(536 / 4000, 9);
  });

  it('never upscales past 1', () => {
    const fit = fitToViewport({ width: 200, height: 100 }, { width: 800, height: 600 });
    expect(fit.scale).toBe(1);
  });

  it('respects MIN_SCALE for enormous diagrams', () => {
    const fit = fitToViewport({ width: 1_000_000, height: 400 }, { width: 800, height: 600 });
    expect(fit.scale).toBe(MIN_SCALE);
  });

  it('returns identity for a degenerate viewport or content without NaN', () => {
    expect(fitToViewport({ width: 100, height: 100 }, { width: 0, height: 0 })).toEqual(IDENTITY);
    expect(fitToViewport({ width: 0, height: 0 }, { width: 800, height: 600 })).toEqual(IDENTITY);
  });
});

describe('parseSvgIntrinsicSize', () => {
  it('reads a realistic mermaid header', () => {
    const svg =
      '<svg id="mermaid-1" width="100%" style="max-width: 412.5px;" viewBox="0 0 412.5 268" xmlns="http://www.w3.org/2000/svg">';
    expect(parseSvgIntrinsicSize(svg)).toEqual({ width: 412.5, height: 268 });
  });

  it('accepts a comma-separated viewBox', () => {
    expect(parseSvgIntrinsicSize('<svg viewBox="0,0,300,150">')).toEqual({
      width: 300,
      height: 150,
    });
  });

  it('ignores a non-zero viewBox origin', () => {
    expect(parseSvgIntrinsicSize('<svg viewBox="-8 -8 640 480">')).toEqual({
      width: 640,
      height: 480,
    });
  });

  it('accepts single quotes and extra whitespace', () => {
    expect(parseSvgIntrinsicSize("<svg viewBox = ' 0 0 120 60 '>")).toEqual({
      width: 120,
      height: 60,
    });
  });

  it('falls back to inline max-width when there is no viewBox', () => {
    expect(parseSvgIntrinsicSize('<svg width="100%" style="max-width: 400px;">')).toEqual({
      width: 400,
      height: 300,
    });
  });

  it('returns null when no size signal is present', () => {
    expect(parseSvgIntrinsicSize('<svg><g></g></svg>')).toBeNull();
  });

  it('rejects a degenerate viewBox', () => {
    expect(parseSvgIntrinsicSize('<svg viewBox="0 0 0 0">')).toBeNull();
  });
});
