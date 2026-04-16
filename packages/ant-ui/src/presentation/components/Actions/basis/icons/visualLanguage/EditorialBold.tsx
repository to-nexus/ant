export function EditorialBoldPreview({ className = '' }: { className?: string }) {
  const base = `w-12 h-8 rounded overflow-hidden flex flex-col ${className}`;
  return (
    <div className={`${base} bg-white p-1 gap-0.5`}>
      <div className="h-1.5 w-7 bg-gray-900 rounded-sm" />
      <div className="h-0.5 w-5 bg-gray-200 rounded-full" />
      <div className="flex-1 flex items-end">
        <div className="h-1.5 w-3 bg-red-500/70 rounded-sm" />
      </div>
    </div>
  );
}

export function EditorialBoldFullPreview({ className = '' }: { className?: string }) {
  const base = `w-full aspect-[2/1] rounded-lg overflow-hidden ${className}`;
  return (
    <div className={`${base} bg-white`}>
      {/* Minimal editorial nav */}
      <div className="flex items-center px-4 py-2 border-b border-gray-100">
        <div className="h-2.5 w-14 bg-gray-900 rounded-sm" />
        <div className="ml-auto">
          <div className="h-1.5 w-5 bg-gray-300 rounded-full" />
        </div>
      </div>
      {/* Magazine-style content with dramatic whitespace */}
      <div className="p-4 flex flex-col gap-3">
        <div className="h-6 w-3/4 bg-gray-900 rounded-sm" />
        <div className="h-1.5 w-full bg-gray-200 rounded" />
        <div className="h-1.5 w-2/3 bg-gray-100 rounded" />
        <div className="flex gap-3 pt-1">
          <div className="h-5 w-14 rounded-sm bg-gray-900" />
          <div className="h-5 w-3 rounded-sm bg-red-500/70" />
        </div>
      </div>
    </div>
  );
}
