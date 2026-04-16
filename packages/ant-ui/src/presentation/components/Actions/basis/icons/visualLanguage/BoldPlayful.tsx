export function BoldPlayfulPreview({ className = '' }: { className?: string }) {
  const base = `w-12 h-8 rounded overflow-hidden flex flex-col ${className}`;
  return (
    <div className={`${base} bg-white p-1 gap-0.5`}>
      <div className="h-1 w-5 bg-purple-400 rounded-full" />
      <div className="h-1 w-4 bg-green-300 rounded-full" />
      <div className="flex-1 flex items-end">
        <div className="h-2 w-5 rounded-lg bg-purple-500" />
      </div>
    </div>
  );
}

export function BoldPlayfulFullPreview({ className = '' }: { className?: string }) {
  const base = `w-full aspect-[2/1] rounded-lg overflow-hidden ${className}`;
  return (
    <div className={`${base} bg-white`}>
      {/* Playful nav */}
      <div className="flex items-center px-3 py-2 border-b border-purple-100">
        <div className="w-2.5 h-2.5 rounded-full bg-purple-500" />
        <div className="h-2 w-10 bg-purple-200 rounded-full ml-1.5" />
        <div className="ml-auto">
          <div className="h-2 w-6 bg-green-300 rounded-full" />
        </div>
      </div>
      {/* Bold dual-tone content with large radius */}
      <div className="p-3 flex flex-col gap-2">
        <div className="h-3.5 w-2/3 bg-purple-200 rounded-xl" />
        <div className="flex gap-1.5">
          <div className="flex-1 h-10 rounded-xl bg-purple-50 border border-purple-100 p-1.5">
            <div className="h-1.5 w-8 bg-purple-300/60 rounded-full" />
            <div className="h-1 w-5 bg-purple-200/40 rounded-full mt-1" />
          </div>
          <div className="flex-1 h-10 rounded-xl bg-green-50 border border-green-100 p-1.5">
            <div className="h-1.5 w-6 bg-green-300/60 rounded-full" />
            <div className="h-1 w-4 bg-green-200/40 rounded-full mt-1" />
          </div>
        </div>
        <div className="h-5 w-16 rounded-xl bg-purple-500 self-start" />
      </div>
    </div>
  );
}
