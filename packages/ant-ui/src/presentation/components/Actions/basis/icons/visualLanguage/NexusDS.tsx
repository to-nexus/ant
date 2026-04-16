export function NexusDSPreview({ className = '' }: { className?: string }) {
  const base = `w-12 h-8 rounded overflow-hidden flex flex-col ${className}`;
  return (
    <div className={`${base} bg-[#1E232E] p-1 gap-0.5`}>
      <div className="h-0.5 w-6 bg-[#EAEDEE]/60 rounded-full" />
      <div className="h-0.5 w-4 bg-[#EAEDEE]/30 rounded-full" />
      <div className="flex-1 flex items-end gap-0.5">
        <div className="h-2 w-4 rounded-sm bg-[#252B39] border border-[#363B4C]" />
        <div className="h-1.5 w-3 rounded-sm bg-[#09B498]/50" />
      </div>
    </div>
  );
}

export function NexusDSFullPreview({ className = '' }: { className?: string }) {
  const base = `w-full aspect-[2/1] rounded-lg overflow-hidden ${className}`;
  return (
    <div className={`${base} bg-[#1E232E]`}>
      {/* Top nav — dark bg-subtle */}
      <div className="flex items-center px-3 py-1.5 bg-[#161A21] border-b border-[#363B4C]">
        <div className="h-1.5 w-10 bg-[#09B498]/60 rounded-sm" />
        <div className="ml-auto flex gap-1.5">
          <div className="h-1.5 w-5 bg-[#EAEDEE]/30 rounded-sm" />
          <div className="h-1.5 w-5 bg-[#EAEDEE]/30 rounded-sm" />
        </div>
      </div>
      {/* Metric cards — surface-default with border */}
      <div className="px-2 pt-2 flex gap-1.5">
        <div className="flex-1 rounded bg-[#252B39] border border-[#363B4C] p-1.5">
          <div className="h-1 w-6 bg-[#EAEDEE]/30 rounded-full" />
          <div className="h-3 w-10 bg-[#09B498]/40 rounded mt-1" />
          <div className="h-1 w-8 bg-[#EAEDEE]/15 rounded-full mt-0.5" />
        </div>
        <div className="flex-1 rounded bg-[#252B39] border border-[#363B4C] p-1.5">
          <div className="h-1 w-5 bg-[#EAEDEE]/30 rounded-full" />
          <div className="h-3 w-8 bg-[#EAEDEE]/20 rounded mt-1" />
          <div className="h-1 w-6 bg-[#EAEDEE]/15 rounded-full mt-0.5" />
        </div>
        <div className="flex-1 rounded bg-[#252B39] border border-[#363B4C] p-1.5">
          <div className="h-1 w-7 bg-[#EAEDEE]/30 rounded-full" />
          <div className="h-3 w-9 bg-[#DB0A2D]/30 rounded mt-1" />
          <div className="h-1 w-5 bg-[#EAEDEE]/15 rounded-full mt-0.5" />
        </div>
      </div>
      {/* Mini bar chart area */}
      <div className="px-2 pt-1.5 flex items-end gap-[2px] h-6">
        {[4, 6, 3, 7, 5, 8, 6, 4, 7, 5].map((h, i) => (
          <div
            key={i}
            className="flex-1 rounded-t-sm bg-[#09B498]/30 border-t border-[#09B498]/50"
            style={{ height: `${h * 2}px` }}
          />
        ))}
      </div>
    </div>
  );
}
