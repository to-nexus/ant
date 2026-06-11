/**
 * Ambient aurora mesh background — four blurred, drifting color blobs fixed
 * behind all content (z-0, pointer-events:none). Pure CSS; styling lives in
 * app/aurora.css. Reduced-motion freezes the drift via the global media query.
 */
export function AuroraMesh() {
  return (
    <div className="aurora-mesh" aria-hidden="true">
      <div className="blob blob-1" />
      <div className="blob blob-2" />
      <div className="blob blob-3" />
      <div className="blob blob-4" />
    </div>
  );
}
