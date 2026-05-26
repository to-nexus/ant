
import * as React from 'react';

/**
 * Aurora Icon — inline SVG glyph table ported from
 * visual/ui/handoff/project/ui.jsx. Names match the handoff inventory
 * verbatim; unknown names fall back to a plain circle.
 *
 * Stays portable: no DOM globals at module evaluation, no external
 * dependencies. `currentColor` is used everywhere so callers can recolor
 * via `style.color` or a parent's color.
 */
export interface IconProps {
  name: string;
  size?: number;
  stroke?: number;
  className?: string;
  style?: React.CSSProperties;
}

export function Icon({
  name,
  size = 16,
  stroke = 2,
  className,
  style,
}: IconProps) {
  const mergedStyle: React.CSSProperties = { width: size, height: size, ...style };
  const props = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    stroke: 'currentColor',
    strokeWidth: stroke,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    style: mergedStyle,
    'aria-hidden': true,
    focusable: false,
  };

  switch (name) {
    case 'sparkles':
      return (
        <svg {...props}>
          <path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3z" />
          <path d="M19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14z" />
          <path d="M5 14l.6 1.4L7 16l-1.4.6L5 18l-.6-1.4L3 16l1.4-.6L5 14z" />
        </svg>
      );
    case 'arrow-right':
      return (
        <svg {...props}>
          <path d="M5 12h14M13 5l7 7-7 7" />
        </svg>
      );
    case 'arrow-up':
      return (
        <svg {...props}>
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
      );
    case 'send':
      return (
        <svg {...props}>
          <path d="M5 12L19 5l-3 14-4-6-7-1z" />
        </svg>
      );
    case 'check':
      return (
        <svg {...props}>
          <path d="M5 13l4 4L19 7" />
        </svg>
      );
    case 'plus':
      return (
        <svg {...props}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case 'x':
      return (
        <svg {...props}>
          <path d="M6 6l12 12M6 18L18 6" />
        </svg>
      );
    case 'sun':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" />
        </svg>
      );
    case 'moon':
      return (
        <svg {...props}>
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      );
    case 'circle':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="8" />
        </svg>
      );
    case 'circle-dot':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="3" fill="currentColor" />
        </svg>
      );
    case 'play':
      return (
        <svg {...props} fill="currentColor" stroke="none">
          <path d="M8 5l12 7-12 7V5z" />
        </svg>
      );
    case 'pause':
      return (
        <svg {...props}>
          <path d="M9 5v14M15 5v14" />
        </svg>
      );
    case 'kanban':
      return (
        <svg {...props}>
          <rect x="3" y="4" width="5" height="14" rx="1.5" />
          <rect x="10" y="4" width="5" height="10" rx="1.5" />
          <rect x="17" y="4" width="4" height="7" rx="1.5" />
        </svg>
      );
    case 'workflow':
      return (
        <svg {...props}>
          <rect x="3" y="3" width="6" height="6" rx="1.5" />
          <rect x="15" y="3" width="6" height="6" rx="1.5" />
          <rect x="9" y="15" width="6" height="6" rx="1.5" />
          <path d="M6 9v3a3 3 0 0 0 3 3M18 9v3a3 3 0 0 1-3 3" />
        </svg>
      );
    case 'chat':
      return (
        <svg {...props}>
          <path d="M21 12a8 8 0 0 1-11.3 7.3L4 21l1.7-5.7A8 8 0 1 1 21 12z" />
        </svg>
      );
    case 'folder':
      return (
        <svg {...props}>
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
        </svg>
      );
    case 'file':
      return (
        <svg {...props}>
          <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6z" />
          <path d="M14 3v6h6" />
        </svg>
      );
    case 'settings':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.9 2.9l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.9-2.9l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.9-2.9l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.9 2.9l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </svg>
      );
    case 'search':
      return (
        <svg {...props}>
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
      );
    case 'menu':
      return (
        <svg {...props}>
          <path d="M3 6h18M3 12h18M3 18h18" />
        </svg>
      );
    case 'bolt':
      return (
        <svg {...props}>
          <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
        </svg>
      );
    case 'beaker':
      return (
        <svg {...props}>
          <path d="M9 3h6M10 3v6L4.5 18a2 2 0 0 0 1.7 3h11.6a2 2 0 0 0 1.7-3L14 9V3" />
        </svg>
      );
    case 'cube':
      return (
        <svg {...props}>
          <path d="M12 2L3 7v10l9 5 9-5V7l-9-5z" />
          <path d="M3 7l9 5 9-5M12 12v10" />
        </svg>
      );
    case 'git-branch':
      return (
        <svg {...props}>
          <circle cx="6" cy="6" r="2" />
          <circle cx="6" cy="18" r="2" />
          <circle cx="18" cy="8" r="2" />
          <path d="M6 8v8M18 10v1a4 4 0 0 1-4 4H8" />
        </svg>
      );
    case 'check-circle':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
          <path d="M8 12l3 3 5-6" />
        </svg>
      );
    case 'alert':
      return (
        <svg {...props}>
          <path d="M12 9v4M12 17h.01M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
        </svg>
      );
    case 'compass':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
          <path d="M15.5 8.5L13.5 13.5 8.5 15.5 10.5 10.5z" />
        </svg>
      );
    case 'paperclip':
      return (
        <svg {...props}>
          <path d="M21 11l-9 9a5 5 0 0 1-7-7l9-9a3.5 3.5 0 1 1 5 5L10 18a2 2 0 1 1-3-3l8-8" />
        </svg>
      );
    case 'mic':
      return (
        <svg {...props}>
          <rect x="9" y="3" width="6" height="12" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </svg>
      );
    case 'dots':
      return (
        <svg {...props} fill="currentColor" stroke="none">
          <circle cx="5" cy="12" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="19" cy="12" r="1.5" />
        </svg>
      );
    case 'layout':
      return (
        <svg {...props}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 9h18M9 21V9" />
        </svg>
      );
    case 'palette':
      return (
        <svg {...props}>
          <path d="M12 22a10 10 0 1 1 10-10c0 2-1.8 3.5-4 3.5h-1.8c-1.2 0-2.2 1-2.2 2.2 0 .5.2 1 .5 1.4.3.4.5.9.5 1.4 0 1.2-1 2.2-2.2 2.2-.3 0-.5 0-.8-.1" />
          <circle cx="7.5" cy="11" r="1" fill="currentColor" />
          <circle cx="11.5" cy="7" r="1" fill="currentColor" />
          <circle cx="16" cy="9" r="1" fill="currentColor" />
        </svg>
      );
    case 'type':
      return (
        <svg {...props}>
          <path d="M4 7V4h16v3M9 20h6M12 4v16" />
        </svg>
      );
    case 'box':
      return (
        <svg {...props}>
          <rect x="3" y="3" width="18" height="18" rx="3" />
        </svg>
      );
    case 'zap':
      return (
        <svg {...props} fill="currentColor" stroke="none">
          <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
        </svg>
      );
    case 'chevron-down':
      return (
        <svg {...props}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      );
    case 'chevron-right':
      return (
        <svg {...props}>
          <path d="M9 6l6 6-6 6" />
        </svg>
      );
    case 'chevron-up':
      return (
        <svg {...props}>
          <path d="M18 15l-6-6-6 6" />
        </svg>
      );
    case 'terminal':
      return (
        <svg {...props}>
          <path d="M4 17l6-6-6-6M12 19h8" />
        </svg>
      );
    case 'book':
      return (
        <svg {...props}>
          <path d="M4 4h12a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3V4z" />
          <path d="M4 17a3 3 0 0 1 3-3h12" />
        </svg>
      );
    case 'database':
      return (
        <svg {...props}>
          <ellipse cx="12" cy="5" rx="8" ry="3" />
          <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
        </svg>
      );
    case 'eye':
      return (
        <svg {...props}>
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case 'ban':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
          <path d="M5.5 5.5l13 13" />
        </svg>
      );
    case 'alert-triangle':
      return (
        <svg {...props}>
          <path d="M12 9v4M12 17h.01M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
        </svg>
      );
    case 'target':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="5" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'crosshair':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 3v6M12 15v6M3 12h6M15 12h6" />
        </svg>
      );
    case 'file-text':
      return (
        <svg {...props}>
          <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6z" />
          <path d="M14 3v6h6M8 13h8M8 17h8" />
        </svg>
      );
    case 'briefcase':
      return (
        <svg {...props}>
          <rect x="3" y="7" width="18" height="13" rx="2" />
          <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 12h18" />
        </svg>
      );
    case 'bot':
      return (
        <svg {...props}>
          <rect x="4" y="7" width="16" height="13" rx="2" />
          <circle cx="9" cy="13" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="15" cy="13" r="1.2" fill="currentColor" stroke="none" />
          <path d="M12 3v4M9 17h6" />
        </svg>
      );
    case 'lock':
      return (
        <svg {...props}>
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
      );
    case 'message-square':
      return (
        <svg {...props}>
          <path d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-4 4V5z" />
        </svg>
      );
    case 'clipboard':
      return (
        <svg {...props}>
          <rect x="6" y="4" width="12" height="17" rx="2" />
          <rect x="9" y="2" width="6" height="4" rx="1" />
          <path d="M9 11h6M9 15h6" />
        </svg>
      );
    case 'brain':
      return (
        <svg {...props}>
          <path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 1 5 3 3 0 0 0 4 3V4zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-1 5 3 3 0 0 1-4 3V4z" />
        </svg>
      );
    case 'square':
      return (
        <svg {...props} fill="currentColor" stroke="none">
          <rect x="6" y="6" width="12" height="12" rx="1" />
        </svg>
      );
    case 'shield-alert':
      return (
        <svg {...props}>
          <path d="M12 3l8 3v6c0 4-3.5 7.5-8 9-4.5-1.5-8-5-8-9V6l8-3z" />
          <path d="M12 9v4M12 16h.01" />
        </svg>
      );
    case 'package':
      return (
        <svg {...props}>
          <path d="M3 7l9-4 9 4-9 4-9-4z" />
          <path d="M3 7v10l9 4 9-4V7M12 11v10" />
        </svg>
      );
    case 'shield':
      return (
        <svg {...props}>
          <path d="M12 3l8 3v6c0 4-3.5 7.5-8 9-4.5-1.5-8-5-8-9V6l8-3z" />
        </svg>
      );
    case 'download':
      return (
        <svg {...props}>
          <path d="M12 3v12M6 11l6 6 6-6M5 21h14" />
        </svg>
      );
    case 'eraser':
      return (
        <svg {...props}>
          <path d="M16 3l5 5-9 9H7l-3-3L13 4l3-1z" />
          <path d="M9 12l5 5M22 21H9" />
        </svg>
      );
    case 'trash':
      return (
        <svg {...props}>
          <path d="M4 7h16M10 11v6M14 11v6M5 7l1 13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-13M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
        </svg>
      );
    case 'undo':
      return (
        <svg {...props}>
          <path d="M3 7v6h6" />
          <path d="M3.5 13a9 9 0 1 0 2.5-8.5L3 7" />
        </svg>
      );
    case 'redo':
      return (
        <svg {...props}>
          <path d="M21 7v6h-6" />
          <path d="M20.5 13a9 9 0 1 1-2.5-8.5L21 7" />
        </svg>
      );
    case 'pencil':
      return (
        <svg {...props}>
          <path d="M17 3l4 4-12 12H5v-4L17 3z" />
          <path d="M14 6l4 4" />
        </svg>
      );
    case 'server':
      return (
        <svg {...props}>
          <rect x="3" y="4" width="18" height="6" rx="1.5" />
          <rect x="3" y="14" width="18" height="6" rx="1.5" />
          <circle cx="7" cy="7" r="0.8" fill="currentColor" stroke="none" />
          <circle cx="7" cy="17" r="0.8" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'layers':
      return (
        <svg {...props}>
          <path d="M12 2L2 7l10 5 10-5-10-5z" />
          <path d="M2 12l10 5 10-5M2 17l10 5 10-5" />
        </svg>
      );
    case 'monitor':
      return (
        <svg {...props}>
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </svg>
      );
    case 'github':
      return (
        <svg {...props} fill="currentColor" stroke="none">
          <path d="M12 1.27a11 11 0 0 0-3.48 21.46c.55.1.75-.24.75-.53v-1.85c-3.06.67-3.71-1.3-3.71-1.3-.5-1.28-1.23-1.62-1.23-1.62-1-.68.08-.67.08-.67 1.1.08 1.69 1.14 1.69 1.14.98 1.69 2.58 1.2 3.21.91.1-.71.39-1.2.7-1.48-2.44-.28-5.01-1.22-5.01-5.44 0-1.2.43-2.18 1.13-2.95-.11-.28-.49-1.4.11-2.92 0 0 .93-.3 3.04 1.13a10.6 10.6 0 0 1 5.54 0c2.11-1.43 3.04-1.13 3.04-1.13.6 1.52.22 2.64.11 2.92.7.77 1.13 1.75 1.13 2.95 0 4.23-2.58 5.16-5.03 5.43.4.34.75 1.01.75 2.04v3.03c0 .29.2.64.76.53A11 11 0 0 0 12 1.27z" />
        </svg>
      );
    default:
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="8" />
        </svg>
      );
  }
}
