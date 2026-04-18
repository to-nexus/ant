export interface ProgressBarProps {
  active: boolean;
  className?: string;
}

/**
 * Indeterminate progress bar used by AmbientActivityBar. Renders nothing when
 * inactive so callers can place it unconditionally in their layout.
 *
 * The `ambient-progress` keyframe is defined in tailwind.config.js. If the
 * animation appears broken, verify that the keyframe and animation entries
 * still exist there.
 */
export function ProgressBar({ active, className = '' }: ProgressBarProps) {
  if (!active) return null;
  return (
    <div
      className={`relative h-[2px] w-full overflow-hidden bg-transparent pointer-events-none ${className}`}
      role="progressbar"
      aria-busy
      aria-label="Background activity"
    >
      <div className="absolute inset-y-0 left-0 w-1/3 bg-blue-500/70 animate-ambient-progress" />
    </div>
  );
}
