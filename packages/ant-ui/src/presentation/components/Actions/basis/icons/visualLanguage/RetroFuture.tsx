export function RetroFuturePreview({ className = '' }: { className?: string }) {
  const base = `w-12 h-8 rounded overflow-hidden flex flex-col ${className}`;
  return (
    <div className={`${base} bg-cyan-50 p-1 gap-0.5`}>
      <div className="h-1 w-5 bg-teal-400 rounded-full" />
      <div className="h-1 w-4 bg-pink-300 rounded-full" />
      <div className="flex-1 flex items-end">
        <div className="h-2 w-5 rounded-full bg-gradient-to-r from-teal-400 to-pink-400" />
      </div>
    </div>
  );
}

export function RetroFutureFullPreview({ className = '' }: { className?: string }) {
  const base = `w-full aspect-[2/1] rounded-lg overflow-hidden ${className}`;
  return (
    <div className={`${base} bg-cyan-50`}>
      {/* Retro-futuristic nav with dual-tone */}
      <div className="flex items-center px-3 py-2 border-b border-cyan-200/50">
        <div className="h-2 w-10 bg-teal-500 rounded-full" />
        <div className="ml-auto">
          <div className="h-2 w-6 bg-pink-400 rounded-full" />
        </div>
      </div>
      {/* Glossy pill-shaped elements with gradient fills */}
      <div className="p-3 flex flex-col gap-2">
        <div className="h-3.5 w-2/3 bg-teal-300/50 rounded-full" />
        <div className="flex gap-1.5">
          <div className="flex-1 h-12 rounded-2xl bg-gradient-to-r from-teal-200 to-cyan-200 p-2">
            <div className="h-1.5 w-8 bg-teal-400/60 rounded-full" />
            <div className="h-1 w-5 bg-teal-500/30 rounded-full mt-1" />
          </div>
          <div className="flex-1 h-12 rounded-2xl bg-gradient-to-r from-pink-200 to-purple-200 p-2">
            <div className="h-1.5 w-6 bg-pink-400/60 rounded-full" />
            <div className="h-1 w-4 bg-pink-500/30 rounded-full mt-1" />
          </div>
        </div>
        <div className="h-5 w-16 rounded-full bg-gradient-to-r from-teal-400 to-pink-400 self-start" />
      </div>
    </div>
  );
}
