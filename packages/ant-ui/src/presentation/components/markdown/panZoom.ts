/**
 * panZoom — pure transform math for the diagram viewer.
 *
 * No React, no DOM. The transform contract is
 *   `translate(tx, ty) scale(s)` with `transform-origin: 0 0`
 * so a content-space point `c` maps to surface-space `v = c * s + t`.
 */

export interface PanZoomState {
  scale: number;
  tx: number;
  ty: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Surface-local coordinates (clientX/Y minus the surface's bounding rect origin). */
export interface Point {
  x: number;
  y: number;
}

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 8;

/** Per CSS px of wheel deltaY. */
export const WHEEL_SENSITIVITY = 0.0015;
/** ctrlKey wheel = browser-synthesized trackpad pinch; deltas arrive at zoom-intent magnitude. */
export const PINCH_SENSITIVITY = 0.01;

/**
 * Per-event ceiling on the normalized wheel delta. Momentum scrolling and coarse
 * devices can emit very large single deltas; without a cap one flick slams straight
 * into a zoom stop (and `Math.exp` underflows the factor to exactly 0).
 */
export const MAX_WHEEL_PX = 200;

export const KEY_ZOOM_STEP = 1.2;
export const KEY_PAN_STEP = 60;
export const FIT_PADDING = 32;

export const IDENTITY: PanZoomState = { scale: 1, tx: 0, ty: 0 };

export function clampScale(scale: number): number {
  // NaN is unrecoverable (no ordering), so reset. +/-Infinity is directional and
  // clamps naturally to the corresponding bound — a huge fling should land on
  // MAX_SCALE, not snap back to 100%.
  if (Number.isNaN(scale)) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * Zoom by `factor`, keeping the content point under `p` fixed.
 *
 * `k` is derived from the CLAMPED result, not from `factor`. At a clamp boundary
 * k === 1, so the translation is untouched and the content does not drift while
 * the user keeps scrolling into the stop.
 */
export function zoomAt(state: PanZoomState, factor: number, p: Point): PanZoomState {
  const next = clampScale(state.scale * factor);
  const k = next / state.scale;
  return {
    scale: next,
    tx: p.x - (p.x - state.tx) * k,
    ty: p.y - (p.y - state.ty) * k,
  };
}

/** Translate is applied before scale, so panning is scale-independent (1px drag = 1px move). */
export function panBy(state: PanZoomState, dx: number, dy: number): PanZoomState {
  return { scale: state.scale, tx: state.tx + dx, ty: state.ty + dy };
}

/**
 * Per-axis bound: never expose dead space.
 *
 * Content larger than the viewport pans only until its own edge reaches the viewport
 * edge. Content smaller than the viewport has nowhere meaningful to go, so the axis
 * locks to centered.
 */
function clampAxis(t: number, contentPx: number, viewportPx: number): number {
  // Unmeasured viewport (or empty content): no bound is knowable yet, so leave it be.
  if (viewportPx <= 0 || contentPx <= 0) return t;
  if (contentPx <= viewportPx) return (viewportPx - contentPx) / 2;
  return Math.min(0, Math.max(viewportPx - contentPx, t));
}

/**
 * Constrain a translation so the diagram always fills the viewport (or sits centered
 * when it is smaller). Every state transition must pass through this — panning into
 * empty margin is not how viewers behave.
 */
export function clampPan(state: PanZoomState, content: Size, viewport: Size): PanZoomState {
  return {
    scale: state.scale,
    tx: clampAxis(state.tx, content.width * state.scale, viewport.width),
    ty: clampAxis(state.ty, content.height * state.scale, viewport.height),
  };
}

/**
 * Wheel delta → zoom factor.
 *
 * Exponential so that in-then-out by the same delta returns exactly to the start,
 * N small steps compose into one large step, and the factor can never reach <= 0.
 */
export function wheelFactor(deltaY: number, deltaMode: number, isPinch: boolean): number {
  // DOM_DELTA_LINE(1) ~ 16px, DOM_DELTA_PAGE(2) ~ 100px. Firefox reports LINE.
  const raw = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 100 : deltaY;
  if (!Number.isFinite(raw)) return 1;
  const px = Math.max(-MAX_WHEEL_PX, Math.min(MAX_WHEEL_PX, raw));
  const sensitivity = isPinch ? PINCH_SENSITIVITY : WHEEL_SENSITIVITY;
  return Math.exp(-px * sensitivity);
}

export function centerAtScale(content: Size, viewport: Size, scale: number): PanZoomState {
  return {
    scale,
    tx: (viewport.width - content.width * scale) / 2,
    ty: (viewport.height - content.height * scale) / 2,
  };
}

/**
 * Scale-to-fit, centered. Never upscales past 1 — a small diagram opens at 100%
 * rather than being blown up to fill the screen.
 *
 * Contract: a degenerate (unmeasured) viewport or content yields identity. This is
 * what the DOM-less test environment hits, and it keeps the initial readout at 100%.
 */
export function fitToViewport(content: Size, viewport: Size, padding = FIT_PADDING): PanZoomState {
  if (
    viewport.width <= 0 ||
    viewport.height <= 0 ||
    content.width <= 0 ||
    content.height <= 0
  ) {
    return IDENTITY;
  }
  const w = Math.max(1, viewport.width - padding * 2);
  const h = Math.max(1, viewport.height - padding * 2);
  const raw = Math.min(w / content.width, h / content.height);
  return centerAtScale(content, viewport, clampScale(Math.min(1, raw)));
}

const VIEWBOX_RE =
  /viewBox\s*=\s*["']\s*([-\d.eE+]+)[\s,]+([-\d.eE+]+)[\s,]+([-\d.eE+]+)[\s,]+([-\d.eE+]+)\s*["']/;
const MAX_WIDTH_RE = /max-width:\s*([\d.]+)px/;

/**
 * Read a rendered SVG's intrinsic size from its markup.
 *
 * Mermaid emits `width="100%"`, `style="max-width: Npx"`, a viewBox, and NO height
 * attribute — so measuring the mounted node returns the *container* width, making
 * fit a function of the container instead of the diagram. The viewBox is the only
 * container-independent signal, and reading it from the string means the very first
 * paint is already correctly fitted.
 *
 * Note: this is read-only and string-based on purpose. `patchSvgDimensions` in
 * chat/useImagePreview.ts also reads viewBox but mutates a Blob for <img> rendering —
 * different boundary, deliberately not shared (it would drag async + DOM in here).
 */
export function parseSvgIntrinsicSize(svg: string): Size | null {
  const viewBox = VIEWBOX_RE.exec(svg);
  if (viewBox) {
    const width = Number(viewBox[3]);
    const height = Number(viewBox[4]);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return { width, height };
    }
  }

  // Fallback: inline max-width gives the width; without a viewBox there is no
  // aspect ratio to recover, so assume a 4:3 box rather than returning nothing.
  const maxWidth = MAX_WIDTH_RE.exec(svg);
  if (maxWidth) {
    const width = Number(maxWidth[1]);
    if (Number.isFinite(width) && width > 0) {
      return { width, height: width * 0.75 };
    }
  }

  return null;
}
