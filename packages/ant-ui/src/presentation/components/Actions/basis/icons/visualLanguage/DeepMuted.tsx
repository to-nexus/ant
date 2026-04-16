export function DeepMutedPreview({ className = '' }: { className?: string }) {
  const base = `w-12 h-8 rounded overflow-hidden flex flex-col ${className}`;
  return (
    <div className={`${base} bg-slate-800 p-1 gap-0.5`}>
      <div className="h-1 w-6 bg-slate-600 rounded-full" />
      <div className="h-1 w-4 bg-slate-700 rounded-full" />
      <div className="flex-1 flex items-end">
        <div className="h-2 w-5 rounded-md bg-blue-400/50" />
      </div>
    </div>
  );
}

export function DeepMutedFullPreview({ className = '' }: { className?: string }) {
  const base = `w-full aspect-[2/1] rounded-lg overflow-hidden ${className}`;
  return (
    <div className={`${base} bg-slate-900`}>
      {/* Subdued nav */}
      <div className="flex items-center px-3 py-2 border-b border-slate-700/50">
        <div className="h-1.5 w-10 bg-slate-400/60 rounded-sm" />
        <div className="ml-auto">
          <div className="h-1.5 w-5 bg-slate-600 rounded" />
        </div>
      </div>
      {/* Low-chroma content */}
      <div className="p-3 flex flex-col gap-2">
        <div className="h-3 w-2/3 bg-slate-600/50 rounded" />
        <div className="h-1.5 w-full bg-slate-700/40 rounded" />
        <div className="flex gap-1.5">
          <div className="flex-1 h-10 rounded-lg bg-slate-800 border border-slate-700/50 p-1.5">
            <div className="h-1.5 w-8 bg-slate-600/50 rounded-full" />
            <div className="h-1 w-5 bg-slate-700/40 rounded-full mt-1" />
          </div>
          <div className="flex-1 h-10 rounded-lg bg-slate-800 border border-slate-700/50 p-1.5">
            <div className="h-1.5 w-6 bg-slate-600/50 rounded-full" />
            <div className="h-1 w-4 bg-slate-700/40 rounded-full mt-1" />
          </div>
        </div>
        <div className="h-5 w-14 rounded-md bg-blue-400/40 self-start" />
      </div>
    </div>
  );
}
