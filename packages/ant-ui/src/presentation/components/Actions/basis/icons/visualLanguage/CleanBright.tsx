export function CleanBrightPreview({ className = '' }: { className?: string }) {
  const base = `w-12 h-8 rounded overflow-hidden flex flex-col ${className}`;
  return (
    <div className={`${base} bg-white p-1 gap-0.5`}>
      <div className="h-1 w-6 rounded-full bg-gray-200" />
      <div className="h-1 w-4 rounded-full bg-gray-100" />
      <div className="flex-1 flex items-end">
        <div className="h-2 w-5 rounded-md bg-blue-500" />
      </div>
    </div>
  );
}

export function CleanBrightFullPreview({ className = '' }: { className?: string }) {
  const base = `w-full aspect-[2/1] rounded-lg overflow-hidden ${className}`;
  return (
    <div className={`${base} bg-white`}>
      {/* Nav bar */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-gray-100">
        <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
        <div className="h-1.5 w-12 bg-gray-200 rounded-full" />
        <div className="ml-auto flex gap-1">
          <div className="h-1.5 w-6 bg-gray-100 rounded-full" />
          <div className="h-1.5 w-6 bg-gray-100 rounded-full" />
        </div>
      </div>
      {/* Content */}
      <div className="p-3 flex gap-2">
        <div className="w-1/4 flex flex-col gap-1.5">
          <div className="h-2 w-full bg-gray-100 rounded" />
          <div className="h-2 w-3/4 bg-blue-50 rounded" />
          <div className="h-2 w-full bg-gray-100 rounded" />
        </div>
        <div className="flex-1 flex flex-col gap-2">
          <div className="h-3 w-2/3 bg-gray-200 rounded" />
          <div className="flex gap-1.5">
            <div className="flex-1 h-10 rounded-lg bg-blue-50 border border-blue-100 p-1.5">
              <div className="h-1.5 w-8 bg-blue-300/60 rounded-full" />
            </div>
            <div className="flex-1 h-10 rounded-lg bg-gray-50 border border-gray-100 p-1.5">
              <div className="h-1.5 w-6 bg-gray-200 rounded-full" />
            </div>
          </div>
          <div className="h-5 w-16 rounded-md bg-blue-500 self-start" />
        </div>
      </div>
    </div>
  );
}
