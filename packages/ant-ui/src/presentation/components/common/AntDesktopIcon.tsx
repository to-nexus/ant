interface AntDesktopIconProps {
  className?: string;
  muted?: boolean;
}

/**
 * ANT neural-network logo as an inline SVG icon.
 * Matches the branding in /public/favicon.svg.
 * When `muted` is true, renders in currentColor (inherits text-gray-* from parent).
 */
export function AntDesktopIcon({ className, muted }: AntDesktopIconProps) {
  if (muted) {
    return (
      <svg className={className} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="16" cy="16" r="4" fill="currentColor" opacity="0.7" />
        <circle cx="8" cy="8" r="2.5" fill="currentColor" opacity="0.5" />
        <circle cx="24" cy="8" r="2.5" fill="currentColor" opacity="0.5" />
        <circle cx="8" cy="24" r="2.5" fill="currentColor" opacity="0.5" />
        <circle cx="24" cy="24" r="2.5" fill="currentColor" opacity="0.5" />
        <path d="M9.5 9.5 L12.5 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.3" />
        <path d="M22.5 9.5 L19.5 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.3" />
        <path d="M9.5 22.5 L12.5 19.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.3" />
        <path d="M22.5 22.5 L19.5 19.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.3" />
      </svg>
    );
  }

  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="antGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="4" fill="url(#antGrad)" />
      <circle cx="8" cy="8" r="2.5" fill="#3b82f6" opacity="0.8" />
      <circle cx="24" cy="8" r="2.5" fill="#3b82f6" opacity="0.8" />
      <circle cx="8" cy="24" r="2.5" fill="#8b5cf6" opacity="0.8" />
      <circle cx="24" cy="24" r="2.5" fill="#8b5cf6" opacity="0.8" />
      <path d="M9.5 9.5 L12.5 12.5" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
      <path d="M22.5 9.5 L19.5 12.5" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
      <path d="M9.5 22.5 L12.5 19.5" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
      <path d="M22.5 22.5 L19.5 19.5" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
    </svg>
  );
}
