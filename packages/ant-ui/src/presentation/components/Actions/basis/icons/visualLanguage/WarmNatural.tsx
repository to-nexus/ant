export function WarmNaturalPreview({ className = '' }: { className?: string }) {
  const base = `w-12 h-8 rounded overflow-hidden flex flex-col ${className}`;
  return (
    <div className={`${base} bg-amber-50 p-1 gap-0.5`}>
      <div className="h-1 w-6 bg-amber-200/70 rounded-full" />
      <div className="h-1 w-4 bg-amber-100 rounded-full" />
      <div className="flex-1 flex items-end">
        <div className="h-2 w-5 rounded-md bg-amber-700" />
      </div>
    </div>
  );
}

export function WarmNaturalFullPreview({ className = '' }: { className?: string }) {
  const base = `w-full aspect-[2/1] rounded-lg overflow-hidden ${className}`;
  return (
    <div className={`${base} bg-amber-50/80`}>
      {/* Nav with serif hint */}
      <div className="flex items-center px-3 py-2 border-b border-amber-200/50">
        <div className="h-2 w-12 bg-amber-800/60 rounded-sm" />
        <div className="ml-auto flex gap-2">
          <div className="h-1.5 w-5 bg-amber-300/50 rounded-full" />
          <div className="h-1.5 w-5 bg-amber-300/50 rounded-full" />
        </div>
      </div>
      {/* Warm editorial content */}
      <div className="p-3 flex flex-col gap-2.5">
        <div className="h-3.5 w-1/2 bg-amber-900/30 rounded" />
        <div className="h-1.5 w-full bg-amber-200/40 rounded" />
        <div className="flex gap-2">
          <div className="flex-1 h-10 rounded-lg bg-white/60 border border-amber-200/50 p-2">
            <div className="h-1.5 w-8 bg-amber-300/50 rounded-full" />
            <div className="h-1 w-5 bg-amber-200/40 rounded-full mt-1" />
          </div>
          <div className="flex-1 h-10 rounded-lg bg-white/60 border border-amber-200/50 p-2">
            <div className="h-1.5 w-6 bg-amber-300/50 rounded-full" />
            <div className="h-1 w-4 bg-amber-200/40 rounded-full mt-1" />
          </div>
        </div>
        <div className="h-5 w-16 rounded-md bg-amber-700 self-start" />
      </div>
    </div>
  );
}
