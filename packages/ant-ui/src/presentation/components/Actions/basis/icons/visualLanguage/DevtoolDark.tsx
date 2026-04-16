export function DevtoolDarkPreview({ className = '' }: { className?: string }) {
  const base = `w-12 h-8 rounded overflow-hidden flex flex-col ${className}`;
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
}

export function DevtoolDarkFullPreview({ className = '' }: { className?: string }) {
  const base = `w-full aspect-[2/1] rounded-lg overflow-hidden ${className}`;
  return (
    <div className={`${base} bg-[#0d1117]`}>
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-gray-800">
        <div className="h-2 w-10 bg-gray-800 rounded-sm border-b-2 border-green-400/60 px-1" />
        <div className="h-2 w-8 bg-gray-800/50 rounded-sm" />
        <div className="h-2 w-8 bg-gray-800/50 rounded-sm" />
      </div>
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
      <div className="mt-auto px-2 py-1 border-t border-gray-800 bg-[#0a0e14]">
        <div className="flex items-center gap-0.5">
          <div className="h-1 w-2 bg-green-400/80 rounded-sm" />
          <div className="h-1 w-16 bg-gray-600/50 rounded-sm" />
        </div>
      </div>
    </div>
  );
}
