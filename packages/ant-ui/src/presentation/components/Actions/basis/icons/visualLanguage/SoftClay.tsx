export function SoftClayPreview({ className = '' }: { className?: string }) {
  const base = `w-12 h-8 rounded overflow-hidden flex flex-col ${className}`;
  return (
    <div className={`${base} bg-pink-50 p-1 gap-0.5`}>
      <div className="h-1 w-6 bg-purple-200 rounded-full" />
      <div className="h-1 w-4 bg-pink-200 rounded-full" />
      <div className="flex-1 flex items-end">
        <div className="h-2 w-5 rounded-xl bg-purple-300" style={{ boxShadow: '0 2px 4px rgba(168,85,247,0.3)' }} />
      </div>
    </div>
  );
}

export function SoftClayFullPreview({ className = '' }: { className?: string }) {
  const base = `w-full aspect-[2/1] rounded-lg overflow-hidden ${className}`;
  return (
    <div className={`${base} bg-pink-50`}>
      {/* Soft pastel nav */}
      <div className="flex items-center px-3 py-2">
        <div className="h-2 w-10 bg-purple-300 rounded-full" />
        <div className="ml-auto">
          <div className="h-2 w-6 bg-pink-200 rounded-full" />
        </div>
      </div>
      {/* Puffy clay cards with colored shadows */}
      <div className="p-3 flex flex-col gap-2">
        <div className="h-3.5 w-2/3 bg-purple-200 rounded-full" />
        <div className="flex gap-2">
          {[1, 2].map(i => (
            <div key={i} className="flex-1 h-14 rounded-2xl bg-white p-2.5" style={{ boxShadow: '0 6px 12px rgba(168,85,247,0.2)' }}>
              <div className="h-1.5 w-8 bg-purple-200 rounded-full" />
              <div className="h-1 w-6 bg-pink-200 rounded-full mt-1.5" />
              <div className="h-1 w-4 bg-purple-100 rounded-full mt-1" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
