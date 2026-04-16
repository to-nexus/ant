export function CinematicDarkPreview({ className = '' }: { className?: string }) {
  const base = `w-12 h-8 rounded overflow-hidden flex flex-col ${className}`;
  return (
    <div className={`${base} bg-gray-950 p-1.5 gap-1 justify-center`}>
      <div className="h-1.5 w-6 bg-gray-200/80 rounded-sm" />
      <div className="h-0.5 w-4 bg-gray-700 rounded-full" />
    </div>
  );
}

export function CinematicDarkFullPreview({ className = '' }: { className?: string }) {
  const base = `w-full aspect-[2/1] rounded-lg overflow-hidden ${className}`;
  return (
    <div className={`${base} bg-gray-950 flex flex-col justify-center items-center gap-3 p-6`}>
      {/* Dramatic negative space with centered floating content */}
      <div className="h-5 w-2/3 bg-gray-100/80 rounded-sm" />
      <div className="h-1.5 w-1/2 bg-gray-700 rounded" />
      <div className="h-1.5 w-1/3 bg-gray-800 rounded" />
    </div>
  );
}
