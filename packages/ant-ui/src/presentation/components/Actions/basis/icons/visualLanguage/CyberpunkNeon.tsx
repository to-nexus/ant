export function CyberpunkNeonPreview({ className = '' }: { className?: string }) {
  const base = `w-12 h-8 rounded overflow-hidden flex flex-col ${className}`;
  return (
    <div className={`${base} bg-gray-950 p-1 gap-0.5`}>
      <div className="h-0.5 w-5 bg-cyan-400/80 rounded-full" />
      <div className="h-0.5 w-7 bg-gray-700 rounded-full" />
      <div className="flex-1 flex items-end gap-0.5">
        <div className="h-1.5 w-2 bg-cyan-400/60 rounded-sm" />
        <div className="h-1 w-3 bg-fuchsia-500/50 rounded-sm" />
      </div>
    </div>
  );
}

export function CyberpunkNeonFullPreview({ className = '' }: { className?: string }) {
  const base = `w-full aspect-[2/1] overflow-hidden ${className}`;
  return (
    <div className={`${base} bg-[#0a0a1a] rounded-lg`}>
      {/* Angular neon nav */}
      <div className="flex items-center gap-0.5 px-2.5 py-1.5 border-b border-cyan-900/50">
        <div className="h-2 w-12 bg-cyan-400/70 rounded-sm" style={{ boxShadow: '0 0 6px rgba(34,211,238,0.3)' }} />
        <div className="ml-auto">
          <div className="h-2 w-6 bg-fuchsia-500/50 rounded-sm" style={{ boxShadow: '0 0 4px rgba(217,70,239,0.3)' }} />
        </div>
      </div>
      {/* Neon-lit content with sharp corners and glow */}
      <div className="p-2.5 flex flex-col gap-2">
        <div className="h-3 w-1/2 bg-cyan-400/30 rounded-sm" />
        <div className="flex gap-1.5">
          <div className="flex-1 h-12 bg-gray-900 border border-cyan-500/30 rounded-sm p-1.5">
            <div className="h-1.5 w-full bg-cyan-400/40 rounded-sm" />
            <div className="h-1 w-3/4 bg-gray-700 rounded-sm mt-1" />
            <div className="h-1 w-1/2 bg-cyan-400/20 rounded-sm mt-1" />
          </div>
          <div className="flex-1 h-12 bg-gray-900 border border-fuchsia-500/30 rounded-sm p-1.5">
            <div className="h-1.5 w-full bg-fuchsia-400/30 rounded-sm" />
            <div className="h-1 w-3/4 bg-gray-700 rounded-sm mt-1" />
            <div className="h-1 w-1/2 bg-fuchsia-400/20 rounded-sm mt-1" />
          </div>
        </div>
        <div className="h-5 w-14 rounded-sm bg-cyan-500/60 self-start" style={{ boxShadow: '0 0 8px rgba(34,211,238,0.4)' }} />
      </div>
    </div>
  );
}
