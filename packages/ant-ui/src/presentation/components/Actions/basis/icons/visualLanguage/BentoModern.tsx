export function BentoModernPreview({ className = '' }: { className?: string }) {
  const base = `w-12 h-8 rounded overflow-hidden flex flex-col ${className}`;
  return (
    <div className={`${base} bg-gray-50 p-0.5 gap-0.5`}>
      <div className="h-2 w-5 rounded-md bg-gradient-to-r from-violet-400 to-pink-400" />
      <div className="flex-1 flex gap-0.5">
        <div className="flex-1 h-full rounded bg-gray-200" />
        <div className="flex-1 h-full rounded bg-violet-100" />
      </div>
    </div>
  );
}

export function BentoModernFullPreview({ className = '' }: { className?: string }) {
  const base = `w-full aspect-[2/1] rounded-lg overflow-hidden ${className}`;
  return (
    <div className={`${base} bg-gray-50`}>
      {/* Nav */}
      <div className="flex items-center px-3 py-2">
        <div className="w-2.5 h-2.5 rounded-full bg-violet-500" />
        <div className="h-1.5 w-10 bg-gray-200 rounded-full ml-1.5" />
      </div>
      {/* Asymmetric bento grid with gradient hero */}
      <div className="px-3 grid grid-cols-3 gap-1.5">
        <div className="col-span-2 h-12 rounded-xl bg-gradient-to-br from-violet-400 to-pink-400 p-2">
          <div className="h-2 w-12 bg-white/60 rounded-full" />
          <div className="h-1.5 w-8 bg-white/30 rounded-full mt-1" />
        </div>
        <div className="h-12 rounded-xl bg-gray-200 p-2">
          <div className="h-1.5 w-6 bg-gray-400 rounded-full" />
        </div>
        <div className="h-8 rounded-xl bg-violet-100 p-2">
          <div className="h-1.5 w-6 bg-violet-300 rounded-full" />
        </div>
        <div className="col-span-2 h-8 rounded-xl bg-gray-100 p-2">
          <div className="h-1.5 w-10 bg-gray-300 rounded-full" />
        </div>
      </div>
    </div>
  );
}
