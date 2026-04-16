export function CrispMinimalPreview({ className = '' }: { className?: string }) {
  const base = `w-12 h-8 rounded overflow-hidden flex flex-col ${className}`;
  return (
    <div className={`${base} bg-white p-1.5 gap-1`}>
      <div className="h-1 w-6 bg-gray-800 rounded-sm" />
      <div className="h-0.5 w-4 bg-gray-200 rounded-full" />
      <div className="flex-1 flex items-end">
        <div className="h-1.5 w-3 bg-teal-500 rounded-sm" />
      </div>
    </div>
  );
}

export function CrispMinimalFullPreview({ className = '' }: { className?: string }) {
  const base = `w-full aspect-[2/1] rounded-lg overflow-hidden ${className}`;
  return (
    <div className={`${base} bg-white`}>
      {/* Monochrome nav with single teal accent */}
      <div className="flex items-center px-4 py-2.5">
        <div className="h-2 w-10 bg-gray-800 rounded-sm" />
        <div className="ml-auto flex gap-3">
          <div className="h-1.5 w-5 bg-gray-300 rounded-full" />
        </div>
      </div>
      {/* Typography-driven minimal content */}
      <div className="px-4 pt-1 flex flex-col gap-2.5">
        <div className="h-3.5 w-1/3 bg-gray-800 rounded-sm" />
        <div className="h-1.5 w-full bg-gray-100 rounded" />
        <div className="h-1.5 w-3/4 bg-gray-100 rounded" />
        <div className="flex gap-2 pt-1">
          <div className="flex-1 rounded border border-gray-200 p-2">
            <div className="h-1.5 w-8 bg-gray-200 rounded" />
          </div>
          <div className="flex-1 rounded border border-gray-200 p-2">
            <div className="h-1.5 w-2 bg-teal-500 rounded" />
          </div>
        </div>
      </div>
    </div>
  );
}
