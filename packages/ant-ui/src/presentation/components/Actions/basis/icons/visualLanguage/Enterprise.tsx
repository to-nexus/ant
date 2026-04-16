export function EnterprisePreview({ className = '' }: { className?: string }) {
  const base = `w-12 h-8 rounded overflow-hidden flex flex-col ${className}`;
  return (
    <div className={`${base} bg-gray-100 p-0.5 gap-0.5 border border-gray-300`}>
      <div className="h-1 w-7 bg-gray-400" />
      <div className="h-1 w-5 bg-gray-300" />
      <div className="flex-1 flex items-end">
        <div className="h-2 w-5 bg-slate-700" />
      </div>
    </div>
  );
}

export function EnterpriseFullPreview({ className = '' }: { className?: string }) {
  const base = `w-full aspect-[2/1] rounded-lg overflow-hidden ${className}`;
  return (
    <div className={`${base} bg-gray-50 border border-gray-300`}>
      <div className="flex items-center px-2 py-1.5 bg-slate-800">
        <div className="h-1.5 w-10 bg-white/80 rounded-sm" />
        <div className="ml-auto flex gap-2">
          <div className="h-1.5 w-5 bg-white/40" />
          <div className="h-1.5 w-5 bg-white/40" />
          <div className="h-1.5 w-5 bg-white/40" />
        </div>
      </div>
      <div className="flex items-center gap-1 px-2 py-1 border-b border-gray-300 bg-gray-100">
        <div className="h-2 w-8 bg-gray-300 rounded-sm" />
        <div className="h-2 w-8 bg-gray-300 rounded-sm" />
        <div className="h-2 w-8 bg-gray-300 rounded-sm" />
      </div>
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
}
