import { useAmbientSources } from './useAmbientSources';
import { ProgressBar } from '../primitives';

/**
 * Thin, non-blocking progress indicator intended to live at the bottom
 * edge of the AppNavBar. Never occupies body layout — only renders a
 * 2-px bar when some global work is in flight.
 *
 * Layout contract: absolute position inside AppNavBar's own stacking
 * context. Do NOT wrap in a fixed container (would re-compute zIndex).
 */
export function AmbientActivityBar({ className = '' }: { className?: string }) {
  const { active } = useAmbientSources();
  // z-[1] keeps the bar above sibling content inside AppNavBar's own
  // stacking context without escaping into the global z-index hierarchy.
  return (
    <div
      className={`absolute bottom-0 left-0 right-0 z-[1] pointer-events-none ${className}`.trim()}
    >
      <ProgressBar active={active} />
    </div>
  );
}
