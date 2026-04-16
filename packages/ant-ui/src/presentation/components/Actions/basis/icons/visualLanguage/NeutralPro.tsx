export function NeutralProPreview({ className = '' }: { className?: string }) {
  const base = `w-12 h-8 rounded overflow-hidden flex flex-col ${className}`;
  return (
    <div className={`${base} bg-gray-50 p-1 gap-0.5`}>
      <div className="h-1 w-7 bg-gray-300 rounded-sm" />
      <div className="h-1 w-5 bg-gray-200 rounded-sm" />
      <div className="flex-1 flex items-end">
        <div className="h-2 w-5 bg-slate-600 rounded-sm" />
      </div>
    </div>
  );
}

export function NeutralProFullPreview({ className = '' }: { className?: string }) {
  const base = `w-full aspect-[2/1] rounded-lg overflow-hidden ${className}`;
  return (
    <div className={`${base} bg-gray-50 border border-gray-200`}>
      {/* Dense nav */}
      <div className="flex items-center px-3 py-1.5 border-b border-gray-200">
        <div className="h-1.5 w-10 bg-slate-600 rounded-sm" />
        <div className="ml-auto flex gap-2">
          <div className="h-1.5 w-5 bg-gray-300" />
          <div className="h-1.5 w-5 bg-gray-300" />
          <div className="h-1.5 w-5 bg-gray-300" />
        </div>
      </div>
      {/* High-density 3-column content */}
      <div className="p-2 flex flex-col gap-1.5">
        <div className="h-2.5 w-1/2 bg-gray-300 rounded-sm" />
        <div className="flex gap-1">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex-1 bg-white border border-gray-200 rounded-sm p-1.5">
              <div className="h-1.5 w-full bg-gray-200 rounded-sm mb-1" />
              <div className="h-1 w-3/4 bg-gray-100 rounded-sm" />
              <div className="h-1 w-1/2 bg-gray-100 rounded-sm mt-0.5" />
            </div>
          ))}
        </div>
        <div className="h-4 w-12 rounded-sm bg-slate-700 self-start" />
      </div>
    </div>
  );
}
