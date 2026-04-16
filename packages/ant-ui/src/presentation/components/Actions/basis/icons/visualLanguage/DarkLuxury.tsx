export function DarkLuxuryPreview({ className = '' }: { className?: string }) {
  const base = `w-12 h-8 rounded overflow-hidden flex flex-col ${className}`;
  return (
    <div className={`${base} bg-gray-950 p-1 gap-0.5`}>
      <div className="h-0.5 w-6 bg-amber-400/60 rounded-full" />
      <div className="h-1 w-4 bg-gray-800 rounded" />
      <div className="flex-1 flex items-end">
        <div className="h-2 w-5 rounded bg-amber-500/40" />
      </div>
    </div>
  );
}

export function DarkLuxuryFullPreview({ className = '' }: { className?: string }) {
  const base = `w-full aspect-[2/1] rounded-lg overflow-hidden ${className}`;
  return (
    <div className={`${base} bg-gray-950`}>
      {/* Luxury nav with gold accent */}
      <div className="flex items-center px-3 py-2">
        <div className="h-2 w-14 bg-amber-400/50 rounded-full" />
        <div className="ml-auto">
          <div className="h-1.5 w-6 bg-gray-700 rounded" />
        </div>
      </div>
      {/* Premium card layout with gold borders */}
      <div className="px-3 flex gap-2">
        <div className="flex-1 rounded-lg bg-gray-800/80 border border-amber-500/20 p-2">
          <div className="h-1 w-8 bg-gray-600 rounded-full" />
          <div className="h-1 w-5 bg-gray-700 rounded-full mt-1" />
          <div className="h-4 w-12 bg-amber-400/30 rounded mt-2" />
        </div>
        <div className="flex-1 rounded-lg bg-gray-800/80 border border-gray-700/50 p-2">
          <div className="h-1 w-6 bg-gray-600 rounded-full" />
          <div className="h-1 w-4 bg-gray-700 rounded-full mt-1" />
          <div className="h-4 w-10 bg-gray-700 rounded mt-2" />
        </div>
      </div>
    </div>
  );
}
