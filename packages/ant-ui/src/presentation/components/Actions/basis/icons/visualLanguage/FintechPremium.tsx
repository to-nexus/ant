export function FintechPremiumPreview({ className = '' }: { className?: string }) {
  const base = `w-12 h-8 rounded overflow-hidden flex flex-col ${className}`;
  return (
    <div className={`${base} bg-slate-900 p-1 gap-0.5`}>
      <div className="h-0.5 w-6 bg-amber-400/60 rounded-full" />
      <div className="h-1 w-4 bg-slate-700 rounded" />
      <div className="flex-1 flex items-end gap-0.5">
        <div className="h-2 w-3 rounded bg-aurora-emerald-500/40 border border-aurora-emerald-400/30" />
        <div className="h-1.5 w-3 rounded bg-amber-500/30" />
      </div>
    </div>
  );
}

export function FintechPremiumFullPreview({ className = '' }: { className?: string }) {
  const base = `w-full aspect-[2/1] rounded-lg overflow-hidden ${className}`;
  return (
    <div className={`${base} bg-slate-950`}>
      <div className="flex items-center px-3 py-2">
        <div className="h-2 w-14 bg-amber-400/50 rounded-full" />
        <div className="ml-auto flex gap-1.5">
          <div className="w-2 h-2 rounded-full bg-aurora-emerald-500/40 border border-aurora-emerald-400/30" />
          <div className="h-1.5 w-6 bg-slate-700 rounded" />
        </div>
      </div>
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
      <div className="px-3 pt-2 flex items-end gap-0.5 h-8">
        {[3, 5, 4, 7, 6, 8, 5, 7].map((h, i) => (
          <div key={i} className="flex-1 rounded-t-sm bg-aurora-emerald-500/30 border-t border-aurora-emerald-400/40" style={{ height: `${h * 3}px` }} />
        ))}
      </div>
    </div>
  );
}
