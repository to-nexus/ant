export function NeoBrutalistPreview({ className = '' }: { className?: string }) {
  const base = `w-12 h-8 rounded overflow-hidden flex flex-col ${className}`;
  return (
    <div className={`${base} bg-yellow-50 p-0.5 gap-0.5 border-2 border-black`}>
      <div className="h-1 w-7 bg-black" />
      <div className="h-1 w-5 bg-gray-300" />
      <div className="flex-1 flex items-end">
        <div className="h-2 w-5 bg-yellow-400 border-2 border-black" style={{ boxShadow: '2px 2px 0 black' }} />
      </div>
    </div>
  );
}

export function NeoBrutalistFullPreview({ className = '' }: { className?: string }) {
  const base = `w-full aspect-[2/1] overflow-hidden ${className}`;
  return (
    <div className={`${base} bg-yellow-50 border-[3px] border-black`}>
      {/* Brutalist nav — zero radius, thick borders */}
      <div className="flex items-center px-2 py-1.5 border-b-[3px] border-black bg-white">
        <div className="h-2.5 w-14 bg-black" />
        <div className="ml-auto">
          <div className="h-2.5 w-10 bg-yellow-400 border-2 border-black" style={{ boxShadow: '2px 2px 0 black' }} />
        </div>
      </div>
      {/* Hard-edged content with offset shadows */}
      <div className="p-2.5 flex flex-col gap-2">
        <div className="h-4 w-2/3 bg-black" />
        <div className="h-1.5 w-full bg-gray-300" />
        <div className="flex gap-2">
          {[1, 2].map(i => (
            <div key={i} className="flex-1 bg-white border-[3px] border-black p-1.5" style={{ boxShadow: '4px 4px 0 black' }}>
              <div className="h-1.5 w-full bg-gray-300 mb-1" />
              <div className="h-1 w-3/4 bg-gray-200" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
