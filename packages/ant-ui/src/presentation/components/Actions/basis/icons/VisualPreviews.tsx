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
      return <SurfaceStylePreview variant={variant} className={className} />;
    case 'spatialSystem':
      return <SpatialDensityPreview variant={variant} className={className} />;
  }
}

function VisualLanguageMoodboard({ variant, className, size }: { variant: string; className: string; size: 'icon' | 'full' }) {
  if (size === 'full') {
    return <VisualLanguageFullPreview variant={variant} className={className} />;
  }

  const base = `w-12 h-8 rounded overflow-hidden flex flex-col ${className}`;

  switch (variant) {
    case 'modernSaas':
      return (
        <div className={`${base} bg-white p-1 gap-0.5`}>
          <div className="h-1 w-6 rounded-full bg-gray-200" />
          <div className="h-1 w-4 rounded-full bg-gray-100" />
          <div className="flex-1 flex items-end">
            <div className="h-2 w-5 rounded-md bg-gradient-to-r from-blue-400 to-blue-500" />
          </div>
        </div>
      );
    case 'enterprise':
      return (
        <div className={`${base} bg-gray-100 p-0.5 gap-0.5 border border-gray-300`}>
          <div className="h-1 w-7 bg-gray-400" />
          <div className="h-1 w-5 bg-gray-300" />
          <div className="flex-1 flex items-end">
            <div className="h-2 w-5 bg-slate-700" />
          </div>
        </div>
      );
    case 'fintechPremium':
      return (
        <div className={`${base} bg-slate-900 p-1 gap-0.5`}>
          <div className="h-0.5 w-6 bg-amber-400/60 rounded-full" />
          <div className="h-1 w-4 bg-slate-700 rounded" />
          <div className="flex-1 flex items-end gap-0.5">
            <div className="h-2 w-3 rounded bg-emerald-500/40 border border-emerald-400/30" />
            <div className="h-1.5 w-3 rounded bg-amber-500/30" />
          </div>
        </div>
      );
    case 'devtoolDark':
      return (
        <div className={`${base} bg-gray-950 p-1 gap-0.5`}>
          <div className="h-0.5 w-5 bg-green-400/70 rounded-full" />
          <div className="h-0.5 w-7 bg-gray-700 rounded-full" />
          <div className="flex-1 flex items-end gap-0.5">
            <div className="h-1.5 w-2 bg-cyan-400/50 rounded-sm" />
            <div className="h-1 w-3 bg-gray-800 rounded-sm" />
          </div>
        </div>
      );
    case 'minimalNeutral':
      return (
        <div className={`${base} bg-white p-1.5 gap-1`}>
          <div className="h-0.5 w-5 bg-gray-300 rounded-full" />
          <div className="h-0.5 w-3 bg-gray-200 rounded-full" />
          <div className="flex-1 flex items-end">
            <div className="h-1.5 w-4 border border-gray-200 rounded-sm" />
          </div>
        </div>
      );
    default:
      return <div className={`${base} bg-gray-100`} />;
  }
}

function VisualLanguageFullPreview({ variant, className }: { variant: string; className: string }) {
  const base = `w-full aspect-[2/1] rounded-lg overflow-hidden ${className}`;

  switch (variant) {
    case 'modernSaas':
      return (
        <div className={`${base} bg-white`}>
          {/* Top nav bar */}
          <div className="flex items-center gap-1.5 px-3 py-2 border-b border-gray-100">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
            <div className="h-1.5 w-12 bg-gray-200 rounded-full" />
            <div className="ml-auto flex gap-1">
              <div className="h-1.5 w-6 bg-gray-100 rounded-full" />
              <div className="h-1.5 w-6 bg-gray-100 rounded-full" />
            </div>
          </div>
          {/* Content area */}
          <div className="p-3 flex gap-2">
            {/* Sidebar */}
            <div className="w-1/4 flex flex-col gap-1.5">
              <div className="h-2 w-full bg-gray-100 rounded" />
              <div className="h-2 w-3/4 bg-blue-50 rounded" />
              <div className="h-2 w-full bg-gray-100 rounded" />
              <div className="h-2 w-5/6 bg-gray-100 rounded" />
            </div>
            {/* Main content */}
            <div className="flex-1 flex flex-col gap-2">
              <div className="h-3 w-2/3 bg-gray-200 rounded" />
              <div className="flex gap-1.5">
                <div className="flex-1 h-10 rounded-lg bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-100 p-1.5">
                  <div className="h-1.5 w-8 bg-blue-300/60 rounded-full" />
                  <div className="h-1 w-5 bg-blue-200/40 rounded-full mt-1" />
                </div>
                <div className="flex-1 h-10 rounded-lg bg-gray-50 border border-gray-100 p-1.5">
                  <div className="h-1.5 w-6 bg-gray-200 rounded-full" />
                  <div className="h-1 w-8 bg-gray-100 rounded-full mt-1" />
                </div>
              </div>
              <div className="h-5 w-16 rounded-md bg-gradient-to-r from-blue-500 to-blue-600 self-start" />
            </div>
          </div>
        </div>
      );
    case 'enterprise':
      return (
        <div className={`${base} bg-gray-50 border border-gray-300`}>
          {/* Dense header */}
          <div className="flex items-center px-2 py-1.5 bg-slate-800">
            <div className="h-1.5 w-10 bg-white/80 rounded-sm" />
            <div className="ml-auto flex gap-2">
              <div className="h-1.5 w-5 bg-white/40" />
              <div className="h-1.5 w-5 bg-white/40" />
              <div className="h-1.5 w-5 bg-white/40" />
            </div>
          </div>
          {/* Toolbar */}
          <div className="flex items-center gap-1 px-2 py-1 border-b border-gray-300 bg-gray-100">
            <div className="h-2 w-8 bg-gray-300 rounded-sm" />
            <div className="h-2 w-8 bg-gray-300 rounded-sm" />
            <div className="h-2 w-8 bg-gray-300 rounded-sm" />
          </div>
          {/* Table-like layout */}
          <div className="p-2 flex flex-col gap-[3px]">
            <div className="flex gap-1">
              <div className="h-2 flex-1 bg-gray-300" />
              <div className="h-2 flex-1 bg-gray-300" />
              <div className="h-2 flex-1 bg-gray-300" />
            </div>
            {[1, 2, 3].map(i => (
              <div key={i} className="flex gap-1">
                <div className="h-2 flex-1 bg-white border border-gray-200" />
                <div className="h-2 flex-1 bg-white border border-gray-200" />
                <div className="h-2 flex-1 bg-white border border-gray-200" />
              </div>
            ))}
          </div>
        </div>
      );
    case 'fintechPremium':
      return (
        <div className={`${base} bg-slate-950`}>
          {/* Top bar */}
          <div className="flex items-center px-3 py-2">
            <div className="h-2 w-14 bg-amber-400/50 rounded-full" />
            <div className="ml-auto flex gap-1.5">
              <div className="w-2 h-2 rounded-full bg-emerald-500/40 border border-emerald-400/30" />
              <div className="h-1.5 w-6 bg-slate-700 rounded" />
            </div>
          </div>
          {/* Dashboard cards */}
          <div className="px-3 flex gap-2">
            <div className="flex-1 rounded-lg bg-slate-800/80 border border-slate-700/50 p-2">
              <div className="h-1 w-8 bg-slate-600 rounded-full" />
              <div className="h-4 w-12 bg-gradient-to-r from-emerald-400/60 to-emerald-500/40 rounded mt-1.5" />
              <div className="h-1 w-10 bg-slate-700 rounded-full mt-1" />
            </div>
            <div className="flex-1 rounded-lg bg-slate-800/80 border border-amber-500/20 p-2">
              <div className="h-1 w-6 bg-slate-600 rounded-full" />
              <div className="h-4 w-10 bg-amber-400/30 rounded mt-1.5" />
              <div className="h-1 w-8 bg-slate-700 rounded-full mt-1" />
            </div>
          </div>
          {/* Chart area */}
          <div className="px-3 pt-2 flex items-end gap-0.5 h-8">
            {[3, 5, 4, 7, 6, 8, 5, 7].map((h, i) => (
              <div key={i} className="flex-1 rounded-t-sm bg-emerald-500/30 border-t border-emerald-400/40" style={{ height: `${h * 3}px` }} />
            ))}
          </div>
        </div>
      );
    case 'devtoolDark':
      return (
        <div className={`${base} bg-[#0d1117]`}>
          {/* Tab bar */}
          <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-gray-800">
            <div className="h-2 w-10 bg-gray-800 rounded-sm border-b-2 border-green-400/60 px-1" />
            <div className="h-2 w-8 bg-gray-800/50 rounded-sm" />
            <div className="h-2 w-8 bg-gray-800/50 rounded-sm" />
          </div>
          {/* Code editor area */}
          <div className="px-2 py-1.5 flex flex-col gap-[3px] font-mono">
            <div className="flex items-center gap-1">
              <div className="w-3 h-1 bg-gray-700 rounded-sm" />
              <div className="h-1 w-10 bg-purple-400/50 rounded-sm" />
              <div className="h-1 w-6 bg-cyan-400/50 rounded-sm" />
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-1 bg-gray-700 rounded-sm" />
              <div className="h-1 w-4 bg-gray-600 rounded-sm" />
              <div className="h-1 w-12 bg-green-400/50 rounded-sm" />
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-1 bg-gray-700 rounded-sm" />
              <div className="h-1 w-6 bg-orange-400/40 rounded-sm" />
              <div className="h-1 w-8 bg-gray-500/40 rounded-sm" />
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-1 bg-gray-700 rounded-sm" />
              <div className="h-1 w-3 bg-gray-600 rounded-sm" />
              <div className="h-1 w-14 bg-cyan-400/40 rounded-sm" />
            </div>
          </div>
          {/* Terminal area */}
          <div className="mt-auto px-2 py-1 border-t border-gray-800 bg-[#0a0e14]">
            <div className="flex items-center gap-0.5">
              <div className="h-1 w-2 bg-green-400/80 rounded-sm" />
              <div className="h-1 w-16 bg-gray-600/50 rounded-sm" />
            </div>
          </div>
        </div>
      );
    case 'minimalNeutral':
      return (
        <div className={`${base} bg-white`}>
          {/* Airy header */}
          <div className="flex items-center px-4 py-2.5">
            <div className="h-2 w-10 bg-gray-800 rounded-sm" />
            <div className="ml-auto flex gap-3">
              <div className="h-1.5 w-5 bg-gray-300 rounded-full" />
              <div className="h-1.5 w-5 bg-gray-300 rounded-full" />
            </div>
          </div>
          {/* Content with generous whitespace */}
          <div className="px-4 pt-1 flex flex-col gap-2.5">
            <div className="h-2.5 w-20 bg-gray-200 rounded" />
            <div className="h-1.5 w-full bg-gray-100 rounded" />
            <div className="h-1.5 w-3/4 bg-gray-100 rounded" />
            {/* Card row */}
            <div className="flex gap-2 pt-1">
              <div className="flex-1 rounded border border-gray-200 p-2">
                <div className="h-1.5 w-8 bg-gray-200 rounded" />
                <div className="h-1 w-full bg-gray-100 rounded mt-1" />
              </div>
              <div className="flex-1 rounded border border-gray-200 p-2">
                <div className="h-1.5 w-6 bg-gray-200 rounded" />
                <div className="h-1 w-full bg-gray-100 rounded mt-1" />
              </div>
            </div>
          </div>
        </div>
      );
    default:
      return <div className={`${base} bg-gray-100`} />;
  }
}

function SurfaceStylePreview({ variant, className }: { variant: string; className: string }) {
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

function SpatialDensityPreview({ variant, className }: { variant: string; className: string }) {
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
