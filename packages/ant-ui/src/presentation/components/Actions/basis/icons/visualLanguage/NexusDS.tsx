export function NexusDSPreview({ className = '' }: { className?: string }) {
  const base = `w-12 h-8 rounded overflow-hidden relative ${className}`;
  return (
    <div className={`${base} bg-[#0B0E11]`}>
      {/* Network pattern hint */}
      <svg className="absolute inset-0 w-full h-full opacity-20" viewBox="0 0 48 32">
        <circle cx="8" cy="6" r="0.8" fill="#00D5AA" />
        <circle cx="24" cy="4" r="0.5" fill="#00D5AA" />
        <circle cx="38" cy="10" r="0.6" fill="#00D5AA" />
        <circle cx="14" cy="18" r="0.5" fill="#00D5AA" />
        <circle cx="40" cy="24" r="0.7" fill="#00D5AA" />
        <line x1="8" y1="6" x2="24" y2="4" stroke="#00D5AA" strokeWidth="0.3" />
        <line x1="24" y1="4" x2="38" y2="10" stroke="#00D5AA" strokeWidth="0.3" />
        <line x1="8" y1="6" x2="14" y2="18" stroke="#00D5AA" strokeWidth="0.3" />
        <line x1="38" y1="10" x2="40" y2="24" stroke="#00D5AA" strokeWidth="0.3" />
      </svg>
      {/* Mini donut glow */}
      <div className="absolute top-1 right-1.5 w-3 h-3 rounded-full border border-[#00D5AA]/70" style={{ boxShadow: '0 0 4px rgba(0,213,170,0.5)' }} />
      {/* Teal logo bar */}
      <div className="absolute top-0.5 left-1 h-0.5 w-4 bg-[#00D5AA]/70 rounded-full" />
      {/* Stats hint */}
      <div className="absolute bottom-1 left-1 right-1 flex gap-0.5">
        <div className="flex-1 h-1.5 rounded-sm bg-white/[0.06] border border-[#00D5AA]/20" />
        <div className="flex-1 h-1.5 rounded-sm bg-white/[0.06] border border-[#00D5AA]/20" />
        <div className="flex-1 h-1.5 rounded-sm bg-white/[0.06] border border-[#00D5AA]/20" />
      </div>
    </div>
  );
}

export function NexusDSFullPreview({ className = '' }: { className?: string }) {
  const base = `w-full aspect-[2/1] rounded-lg overflow-hidden relative ${className}`;
  return (
    <div className={`${base} bg-[#0B0E11]`}>
      {/* ── Network pattern background ── */}
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 320 160" preserveAspectRatio="xMidYMid slice">
        <defs>
          <radialGradient id="nxGlow" cx="50%" cy="40%" r="50%">
            <stop offset="0%" stopColor="#00D5AA" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#00D5AA" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="320" height="160" fill="url(#nxGlow)" />
        {/* Nodes */}
        <circle cx="40" cy="30" r="1.5" fill="#00D5AA" opacity="0.4" />
        <circle cx="100" cy="20" r="1" fill="#00D5AA" opacity="0.3" />
        <circle cx="160" cy="45" r="1.2" fill="#00D5AA" opacity="0.35" />
        <circle cx="220" cy="25" r="1.8" fill="#00D5AA" opacity="0.25" />
        <circle cx="280" cy="40" r="1" fill="#00D5AA" opacity="0.4" />
        <circle cx="70" cy="55" r="0.8" fill="#00D5AA" opacity="0.2" />
        <circle cx="250" cy="55" r="1.3" fill="#00D5AA" opacity="0.3" />
        <circle cx="300" cy="15" r="0.7" fill="#00D5AA" opacity="0.25" />
        <circle cx="20" cy="60" r="0.9" fill="#00D5AA" opacity="0.2" />
        {/* Edges */}
        <line x1="40" y1="30" x2="100" y2="20" stroke="#00D5AA" strokeWidth="0.4" opacity="0.2" />
        <line x1="100" y1="20" x2="160" y2="45" stroke="#00D5AA" strokeWidth="0.4" opacity="0.15" />
        <line x1="160" y1="45" x2="220" y2="25" stroke="#00D5AA" strokeWidth="0.4" opacity="0.2" />
        <line x1="220" y1="25" x2="280" y2="40" stroke="#00D5AA" strokeWidth="0.4" opacity="0.15" />
        <line x1="40" y1="30" x2="70" y2="55" stroke="#00D5AA" strokeWidth="0.3" opacity="0.15" />
        <line x1="220" y1="25" x2="250" y2="55" stroke="#00D5AA" strokeWidth="0.3" opacity="0.15" />
        <line x1="280" y1="40" x2="300" y2="15" stroke="#00D5AA" strokeWidth="0.3" opacity="0.12" />
        <line x1="20" y1="60" x2="40" y2="30" stroke="#00D5AA" strokeWidth="0.3" opacity="0.12" />
        {/* Hexagon shapes (right side, like reference) */}
        <polygon points="270,30 278,25 286,30 286,40 278,45 270,40" fill="none" stroke="#00D5AA" strokeWidth="0.4" opacity="0.12" />
        <polygon points="285,18 291,14 297,18 297,26 291,30 285,26" fill="none" stroke="#00D5AA" strokeWidth="0.3" opacity="0.08" />
      </svg>

      {/* ── GNB ── */}
      <div className="relative flex items-center px-3 py-1.5 border-b border-[#00D5AA]/10">
        {/* CROSS symbol + logo */}
        <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 mr-0.5" fill="#00D5AA">
          <path d="M6 7.1a1.1 1.1 0 110-2.2h2.6l1.4-1.4-1.5-1.5-1.4 1.4V1.1C6.6.65 6.35.4 5.95 0 5.55.4 5.35.65 4.85 1.1v2.35L3.45 2l-1.5 1.5 1.4 1.4H1.1C.65 5.4.4 5.55 0 6c.4.4.65.65 1.1 1.1h2.3l-1.45 1.45 1.5 1.5L4.85 8.6v2.3C5.35 11.35 5.55 11.6 6 12c.4-.4.65-.65 1.1-1.1V8.6l1.45 1.45 1.5-1.5L8.6 7.1H6z" />
        </svg>
        <div className="h-1.5 w-8 bg-[#EAEDEE]/70 rounded-sm" />
        {/* Nav links with active indicator */}
        <div className="ml-3 flex gap-2 items-end">
          <div className="flex flex-col items-center">
            <div className="h-1 w-5 bg-[#00D5AA]/80 rounded-sm" />
            <div className="h-[1px] w-5 bg-[#00D5AA] mt-0.5 rounded-full" />
          </div>
          <div className="h-1 w-5 bg-[#EAEDEE]/25 rounded-sm" />
          <div className="h-1 w-5 bg-[#EAEDEE]/25 rounded-sm" />
        </div>
        {/* Connect button */}
        <div className="ml-auto h-2.5 w-10 rounded-md border border-[#00D5AA]/60 bg-[#00D5AA]/15 flex items-center justify-center">
          <div className="h-0.5 w-6 bg-[#00D5AA]/80 rounded-full" />
        </div>
      </div>

      {/* ── Hero section with donut chart ── */}
      <div className="relative flex items-center px-4 py-2">
        {/* Title area */}
        <div className="flex-1 flex flex-col gap-1">
          <div className="h-2 w-20 bg-[#EAEDEE]/80 rounded-sm" />
          <div className="h-2.5 w-24 bg-gradient-to-r from-[#00D5AA] to-[#09B498] rounded-sm" />
          <div className="h-1 w-16 bg-[#EAEDEE]/30 rounded-full mt-0.5" />
        </div>
        {/* Donut chart with glow */}
        <div className="relative flex items-center justify-center">
          <div
            className="w-12 h-12 rounded-full border-[2.5px] border-[#00D5AA]/80"
            style={{
              boxShadow: '0 0 12px rgba(0,213,170,0.4), inset 0 0 8px rgba(0,213,170,0.1)',
              borderRightColor: 'rgba(0,213,170,0.15)',
            }}
          />
          <div className="absolute flex flex-col items-center">
            <div className="h-0.5 w-3 bg-[#00D5AA]/60 rounded-full" />
            <div className="h-1.5 w-5 bg-[#EAEDEE]/80 rounded-sm mt-0.5" />
          </div>
        </div>
      </div>

      {/* ── Stats cards (glass morphism) ── */}
      <div className="relative px-3 pt-0.5 flex gap-1.5">
        {[
          { labelW: 'w-8', numW: 'w-10', unit: true },
          { labelW: 'w-9', numW: 'w-8', unit: true },
          { labelW: 'w-10', numW: 'w-7', unit: false },
        ].map((card, i) => (
          <div
            key={i}
            className="flex-1 rounded-md p-1.5 border border-[#00D5AA]/15"
            style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}
          >
            <div className={`h-0.5 ${card.labelW} bg-[#EAEDEE]/25 rounded-full`} />
            <div className={`h-2.5 ${card.numW} bg-[#EAEDEE]/70 rounded-sm mt-1`} />
            {card.unit && <div className="h-0.5 w-4 bg-[#00D5AA]/50 rounded-full mt-0.5" />}
          </div>
        ))}
      </div>

      {/* ── Footer divider ── */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#00D5AA]/20 to-transparent" />
    </div>
  );
}
