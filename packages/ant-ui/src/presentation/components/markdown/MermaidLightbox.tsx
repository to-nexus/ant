/**
 * MermaidLightbox — full-viewport pan/zoom viewer for a rendered mermaid diagram.
 *
 * Receives the already-rendered SVG *string* (backed by MermaidBlock's svgCache), so
 * opening is a pure mount with zero mermaid work, and closing leaves the collapsed
 * diagram — a sibling, never an ancestor — completely untouched.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Maximize, ZoomIn, ZoomOut } from 'lucide-react';
import { LightboxShell } from '../common/LightboxShell';
import { IconButton } from '../aurora';
import {
  IDENTITY,
  KEY_PAN_STEP,
  KEY_ZOOM_STEP,
  type PanZoomState,
  type Size,
  centerAtScale,
  clampPan,
  fitToViewport,
  panBy,
  parseSvgIntrinsicSize,
  wheelFactor,
  zoomAt,
} from './panZoom';

interface MermaidLightboxProps {
  svg: string;
  onClose: () => void;
}

/** Last-resort size when the SVG carries neither a viewBox nor an inline max-width. */
const FALLBACK_SIZE: Size = { width: 800, height: 600 };

export function MermaidLightbox({ svg, onClose }: MermaidLightboxProps) {
  const { t } = useTranslation('common');

  const content = useMemo(() => parseSvgIntrinsicSize(svg) ?? FALLBACK_SIZE, [svg]);

  const surfaceRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const [state, setState] = useState<PanZoomState>(IDENTITY);
  const [dragging, setDragging] = useState(false);

  const contentRef = useRef(content);
  contentRef.current = content;
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  /** Once the user pans/zooms, a container resize must not yank their view. */
  const hasInteractedRef = useRef(false);
  const dragRef = useRef<{ id: number; x: number; y: number } | null>(null);

  const fit = useMemo(() => fitToViewport(content, viewport), [content, viewport]);

  /**
   * Single chokepoint for every state transition, so no call site can leave the
   * diagram panned into empty margin. Reducer form keeps it correct under batching.
   */
  const commit = useCallback((next: (s: PanZoomState) => PanZoomState) => {
    hasInteractedRef.current = true;
    setState((s) => clampPan(next(s), contentRef.current, viewportRef.current));
  }, []);

  // Measure the surface and keep the initial fit in sync until first interaction.
  useLayoutEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      setViewport({ width: rect.width, height: rect.height });
    };
    measure();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (hasInteractedRef.current) {
      // A resize can shrink the viewport past the current bounds — re-clamp without
      // discarding where the user had panned to.
      setState((s) => clampPan(s, contentRef.current, viewport));
      return;
    }
    setState(fitToViewport(contentRef.current, viewport));
  }, [viewport]);

  useEffect(() => {
    surfaceRef.current?.focus();
  }, []);

  // React attaches `wheel` as a PASSIVE root listener, so preventDefault() from a JSX
  // onWheel prop is ignored — zoom would appear to work while the panel behind the
  // dialog scrolls at the same time. This listener must stay imperative.
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const p = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      commit((s) => zoomAt(s, wheelFactor(e.deltaY, e.deltaMode, e.ctrlKey), p));
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [commit]);

  const viewportCenter = useCallback(
    () => ({ x: viewportRef.current.width / 2, y: viewportRef.current.height / 2 }),
    [],
  );

  const zoomByStep = useCallback(
    (factor: number) => {
      commit((s) => zoomAt(s, factor, viewportCenter()));
    },
    [commit, viewportCenter],
  );

  const resetToFit = useCallback(() => {
    commit(() => fitToViewport(contentRef.current, viewportRef.current));
  }, [commit]);

  const zoomToActualSize = useCallback(() => {
    commit(() => centerAtScale(contentRef.current, viewportRef.current, 1));
  }, [commit]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // Pointer capture keeps tracking when the drag crosses the surface edge, passes
    // over the toolbar, or leaves the window — and guarantees a terminating pointerup.
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    setDragging(true);
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.id !== e.pointerId) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      commit((s) => panBy(s, dx, dy));
    },
    [commit],
  );

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.id !== e.pointerId) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    dragRef.current = null;
    setDragging(false);
  }, []);

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = surfaceRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const p = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      commit((s) =>
        Math.abs(s.scale - fit.scale) < 0.01
          ? zoomAt(s, 1 / s.scale, p) // → exactly 1.0, anchored at the cursor
          : fitToViewport(contentRef.current, viewportRef.current),
      );
    },
    [commit, fit.scale],
  );

  // Local, not a window listener: DraftLightbox already owns a window arrow-key
  // listener, and a second global one would leak keys between overlays.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      switch (e.key) {
        case '+':
        case '=':
          zoomByStep(KEY_ZOOM_STEP);
          break;
        case '-':
        case '_':
          zoomByStep(1 / KEY_ZOOM_STEP);
          break;
        case '0':
          resetToFit();
          break;
        case '1':
          zoomToActualSize();
          break;
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'ArrowUp':
        case 'ArrowDown': {
          e.preventDefault();
          const dx = e.key === 'ArrowLeft' ? KEY_PAN_STEP : e.key === 'ArrowRight' ? -KEY_PAN_STEP : 0;
          const dy = e.key === 'ArrowUp' ? KEY_PAN_STEP : e.key === 'ArrowDown' ? -KEY_PAN_STEP : 0;
          commit((s) => panBy(s, dx, dy));
          break;
        }
        default:
          break;
      }
    },
    [commit, resetToFit, zoomByStep, zoomToActualSize],
  );

  return (
    <LightboxShell layout="bleed" scrim="canvas" onClose={onClose} closeLabel={t('mermaid.close')}>
      <div
        ref={surfaceRef}
        data-testid="mermaid-lightbox"
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
        className="absolute inset-0 overflow-hidden outline-none"
        style={{
          touchAction: 'none',
          overscrollBehavior: 'contain',
          cursor: dragging ? 'grabbing' : 'grab',
        }}
      >
        <div
          className="[&>svg]:!max-w-none [&>svg]:w-full [&>svg]:h-full [&>svg]:block"
          style={{
            width: content.width,
            height: content.height,
            transform: `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`,
            transformOrigin: '0 0',
            willChange: 'transform',
            // Same surface as the collapsed block in MermaidBlock, so expanding reads
            // as the same diagram enlarged rather than a differently-themed window.
            background: 'var(--bg-surface)',
            borderRadius: 'var(--r-md)',
            // Outline rather than border: a border would consume 2px of the box and
            // skew the viewBox-exact sizing the transform math depends on.
            boxShadow: '0 0 0 1px var(--border-1)',
          }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>

      <div
        className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-1"
        style={{
          // surface-2 rather than surface: the diagram itself is on --bg-surface, so the
          // toolbar needs the next step in the recess ramp to stay a distinct plane.
          background: 'oklch(from var(--bg-surface-2) l c h / 0.95)',
          border: '1px solid var(--border-1)',
          borderRadius: 'var(--r-pill)',
          boxShadow: 'var(--shadow-lg)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
      >
        <IconButton
          size="sm"
          icon={<ZoomOut className="w-3.5 h-3.5" />}
          aria-label={t('mermaid.zoomOut')}
          title={t('mermaid.zoomOut')}
          onClick={() => zoomByStep(1 / KEY_ZOOM_STEP)}
        />
        <button
          type="button"
          onClick={zoomToActualSize}
          aria-label={t('mermaid.actualSize')}
          title={t('mermaid.actualSize')}
          className="w-14 text-center tabular-nums text-xs rounded-md py-1"
          style={{ background: 'transparent', color: 'var(--text-2)', border: 'none', cursor: 'pointer' }}
        >
          {Math.round(state.scale * 100)}%
        </button>
        <IconButton
          size="sm"
          icon={<ZoomIn className="w-3.5 h-3.5" />}
          aria-label={t('mermaid.zoomIn')}
          title={t('mermaid.zoomIn')}
          onClick={() => zoomByStep(KEY_ZOOM_STEP)}
        />
        <div className="w-px h-5 mx-0.5" style={{ background: 'var(--border-1)' }} />
        <IconButton
          size="sm"
          icon={<Maximize className="w-3.5 h-3.5" />}
          aria-label={t('mermaid.reset')}
          title={t('mermaid.reset')}
          onClick={resetToFit}
        />
        <div className="w-px h-5 mx-0.5" style={{ background: 'var(--border-1)' }} />
        <span className="text-[11px] px-2 hidden sm:inline" style={{ color: 'var(--text-3)' }}>
          {t('mermaid.hint')}
        </span>
      </div>
    </LightboxShell>
  );
}
