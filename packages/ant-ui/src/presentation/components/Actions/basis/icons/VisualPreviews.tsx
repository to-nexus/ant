import { VL_ICON_MAP, VL_FULL_MAP } from './visualLanguage';

interface VisualPreviewProps {
  layer: 'visualLanguage' | 'surfaceSystem' | 'spatialSystem';
  variant: string;
  className?: string;
  size?: 'icon' | 'full';
}

export function VisualPreview({ layer, variant, className = '', size = 'icon' }: VisualPreviewProps) {
  switch (layer) {
    case 'visualLanguage':
      return <VisualLanguageMoodboard variant={variant} className={className} size={size} />;
    case 'surfaceSystem':
      return <SurfaceStylePreview variant={variant} className={className} size={size} />;
    case 'spatialSystem':
      return <SpatialDensityPreview variant={variant} className={className} size={size} />;
  }
}

function VisualLanguageMoodboard({ variant, className, size }: { variant: string; className: string; size: 'icon' | 'full' }) {
  const map = size === 'full' ? VL_FULL_MAP : VL_ICON_MAP;
  const Component = map[variant];
  if (Component) return <Component className={className} />;

  const fallbackClass = size === 'full'
    ? `w-full aspect-[2/1] rounded-lg bg-gray-100 ${className}`
    : `w-12 h-8 rounded bg-gray-100 ${className}`;
  return <div className={fallbackClass} />;
}

function SurfaceStylePreview({ variant, className, size }: { variant: string; className: string; size: 'icon' | 'full' }) {
  if (size === 'full') return <SurfaceStyleFullPreview variant={variant} className={className} />;

  const base = `w-12 h-8 rounded overflow-hidden flex items-center justify-center ${className}`;
  const card = 'w-9 h-5 rounded flex flex-col justify-center p-0.5 gap-0.5';

  switch (variant) {
    case 'solid':
      return (
        <div className={`${base} bg-gray-50`}>
          <div className={`${card} bg-white dark:bg-gray-700`}>
            <div className="h-0.5 w-5 bg-gray-300 rounded-full" />
            <div className="h-0.5 w-3 bg-gray-200 rounded-full" />
          </div>
        </div>
      );
    case 'soft':
      return (
        <div className={`${base} bg-gray-50`}>
          <div className={`${card} bg-white shadow-md`}>
            <div className="h-0.5 w-5 bg-gray-300 rounded-full" />
            <div className="h-0.5 w-3 bg-gray-200 rounded-full" />
          </div>
        </div>
      );
    case 'borderedSoft':
      return (
        <div className={`${base} bg-gray-50`}>
          <div className={`${card} bg-gray-50 border border-gray-200`}>
            <div className="h-0.5 w-5 bg-gray-300 rounded-full" />
            <div className="h-0.5 w-3 bg-gray-200 rounded-full" />
          </div>
        </div>
      );
    case 'tinted':
      return (
        <div className={`${base} bg-gray-50`}>
          <div className={`${card} bg-blue-50 border border-blue-100/50`}>
            <div className="h-0.5 w-5 bg-blue-200 rounded-full" />
            <div className="h-0.5 w-3 bg-blue-100 rounded-full" />
          </div>
        </div>
      );
    case 'glassLight':
      return (
        <div className={`${base} bg-gradient-to-br from-blue-100 to-purple-100`}>
          <div className={`${card} bg-white/60 backdrop-blur-sm border border-white/40`}>
            <div className="h-0.5 w-5 bg-gray-400/50 rounded-full" />
            <div className="h-0.5 w-3 bg-gray-300/50 rounded-full" />
          </div>
        </div>
      );
    default:
      return <div className={`${base} bg-gray-100`} />;
  }
}

function SurfaceStyleFullPreview({ variant, className }: { variant: string; className: string }) {
  const base = `w-full aspect-[2/1] rounded-lg overflow-hidden ${className}`;

  switch (variant) {
    case 'solid':
      return (
        <div className={`${base} bg-gray-100 dark:bg-gray-800 p-3 flex flex-col gap-2`}>
          <div className="h-3 w-1/3 bg-gray-300 dark:bg-gray-600 rounded" />
          <div className="flex gap-2">
            <div className="flex-1 rounded-lg bg-white dark:bg-gray-700 p-2">
              <div className="h-2 w-full bg-gray-200 dark:bg-gray-600 rounded mb-1.5" />
              <div className="h-1.5 w-3/4 bg-gray-100 dark:bg-gray-600/50 rounded" />
            </div>
            <div className="flex-1 rounded-lg bg-white dark:bg-gray-700 p-2">
              <div className="h-2 w-full bg-gray-200 dark:bg-gray-600 rounded mb-1.5" />
              <div className="h-1.5 w-1/2 bg-gray-100 dark:bg-gray-600/50 rounded" />
            </div>
          </div>
        </div>
      );
    case 'soft':
      return (
        <div className={`${base} bg-gray-50 p-3 flex flex-col gap-2`}>
          <div className="h-3 w-1/3 bg-gray-300 rounded" />
          <div className="flex gap-2">
            <div className="flex-1 rounded-lg bg-white shadow-lg p-2">
              <div className="h-2 w-full bg-gray-200 rounded mb-1.5" />
              <div className="h-1.5 w-3/4 bg-gray-100 rounded" />
            </div>
            <div className="flex-1 rounded-lg bg-white shadow-lg p-2">
              <div className="h-2 w-full bg-gray-200 rounded mb-1.5" />
              <div className="h-1.5 w-1/2 bg-gray-100 rounded" />
            </div>
          </div>
        </div>
      );
    case 'borderedSoft':
      return (
        <div className={`${base} bg-gray-50 p-3 flex flex-col gap-2`}>
          <div className="h-3 w-1/3 bg-gray-300 rounded" />
          <div className="flex gap-2">
            <div className="flex-1 rounded-lg bg-gray-50 border border-gray-200 shadow-sm p-2">
              <div className="h-2 w-full bg-gray-200 rounded mb-1.5" />
              <div className="h-1.5 w-3/4 bg-gray-100 rounded" />
            </div>
            <div className="flex-1 rounded-lg bg-gray-50 border border-gray-200 shadow-sm p-2">
              <div className="h-2 w-full bg-gray-200 rounded mb-1.5" />
              <div className="h-1.5 w-1/2 bg-gray-100 rounded" />
            </div>
          </div>
        </div>
      );
    case 'tinted':
      return (
        <div className={`${base} bg-blue-50/50 p-3 flex flex-col gap-2`}>
          <div className="h-3 w-1/3 bg-blue-300/50 rounded" />
          <div className="flex gap-2">
            <div className="flex-1 rounded-lg bg-blue-50 border border-blue-100/50 p-2">
              <div className="h-2 w-full bg-blue-200/50 rounded mb-1.5" />
              <div className="h-1.5 w-3/4 bg-blue-100/50 rounded" />
            </div>
            <div className="flex-1 rounded-lg bg-blue-50 border border-blue-100/50 p-2">
              <div className="h-2 w-full bg-blue-200/50 rounded mb-1.5" />
              <div className="h-1.5 w-1/2 bg-blue-100/50 rounded" />
            </div>
          </div>
        </div>
      );
    case 'glassLight':
      return (
        <div className={`${base} bg-gradient-to-br from-blue-100 to-purple-100 p-3 flex flex-col gap-2`}>
          <div className="h-3 w-1/3 bg-white/50 rounded" />
          <div className="flex gap-2">
            <div className="flex-1 rounded-lg bg-white/50 backdrop-blur-sm border border-white/40 p-2">
              <div className="h-2 w-full bg-white/40 rounded mb-1.5" />
              <div className="h-1.5 w-3/4 bg-white/30 rounded" />
            </div>
            <div className="flex-1 rounded-lg bg-white/50 backdrop-blur-sm border border-white/40 p-2">
              <div className="h-2 w-full bg-white/40 rounded mb-1.5" />
              <div className="h-1.5 w-1/2 bg-white/30 rounded" />
            </div>
          </div>
        </div>
      );
    default:
      return <div className={`${base} bg-gray-100`} />;
  }
}

function SpatialDensityPreview({ variant, className, size }: { variant: string; className: string; size: 'icon' | 'full' }) {
  if (size === 'full') return <SpatialDensityFullPreview variant={variant} className={className} />;

  const base = `w-12 h-8 rounded overflow-hidden flex flex-col items-center justify-center bg-gray-50 ${className}`;

  const gapClass: Record<string, string> = {
    compact8pt: 'gap-px p-0.5',
    balanced8pt: 'gap-0.5 p-1',
    airy8pt: 'gap-1 p-1.5',
    dense12ptHybrid: 'gap-[3px] p-1',
  };

  return (
    <div className={`${base} ${gapClass[variant] ?? 'gap-0.5 p-1'}`}>
      <div className="w-full h-1.5 bg-gray-300 rounded-sm" />
      <div className="w-full h-1.5 bg-gray-200 rounded-sm" />
      <div className="w-full h-1.5 bg-gray-300 rounded-sm" />
    </div>
  );
}

function SpatialDensityFullPreview({ variant, className }: { variant: string; className: string }) {
  const base = `w-full aspect-[2/1] rounded-lg overflow-hidden bg-gray-50 ${className}`;

  const config: Record<string, { gap: string; padding: string; rows: number }> = {
    compact8pt: { gap: 'gap-1', padding: 'p-2', rows: 5 },
    balanced8pt: { gap: 'gap-2', padding: 'p-3', rows: 4 },
    airy8pt: { gap: 'gap-3', padding: 'p-4', rows: 3 },
    dense12ptHybrid: { gap: 'gap-1.5', padding: 'p-2.5', rows: 4 },
  };

  const c = config[variant] ?? config.balanced8pt;

  return (
    <div className={`${base} flex flex-col ${c.gap} ${c.padding}`}>
      <div className="h-2.5 w-1/4 bg-gray-300 rounded-sm mb-0.5" />
      {Array.from({ length: c.rows }).map((_, i) => (
        <div key={i} className={`flex ${c.gap}`}>
          <div className="flex-1 h-4 bg-white border border-gray-200 rounded p-1">
            <div className="h-1.5 w-3/4 bg-gray-200 rounded-sm" />
          </div>
          <div className="flex-1 h-4 bg-white border border-gray-200 rounded p-1">
            <div className="h-1.5 w-1/2 bg-gray-200 rounded-sm" />
          </div>
          <div className="flex-1 h-4 bg-white border border-gray-200 rounded p-1">
            <div className="h-1.5 w-2/3 bg-gray-200 rounded-sm" />
          </div>
        </div>
      ))}
    </div>
  );
}
