import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

// ✅ Global tooltip state - only one tooltip can be open at a time
const tooltipListeners = new Set<(id: string | null) => void>();

function setActiveTooltip(id: string | null) {
  tooltipListeners.forEach(listener => listener(id));
}

export interface TooltipProps {
  /** The trigger element */
  children: React.ReactElement;
  /** Tooltip content */
  content: React.ReactNode;
  /** Placement */
  placement?: 'top' | 'bottom' | 'left' | 'right';
  /** Additional CSS class for tooltip */
  className?: string;
  /**
   * Trigger policy.
   * - 'click' (default): toggle on click, close on outside click.
   * - 'hover': open on mouseenter, close on mouseleave (with a small delay
   *   so the pointer can cross the arrow/gap into the tooltip body without
   *   flickering). Click toggling is disabled in hover mode.
   *
   * Added for TurnTokenGauge/TokenRing which is a read-only indicator where
   * the Cursor-style hover tooltip matches expectations. Kept opt-in so
   * every other Tooltip consumer in the app stays on the original click
   * semantics unchanged.
   */
  trigger?: 'click' | 'hover';
}

/**
 * Reusable Tooltip Component (Click-based, Single Instance, Portal-based)
 * 
 * Features:
 * - Click to toggle (not hover)
 * - Only one tooltip open at a time (global state)
 * - Click outside to close
 * - Z-index: 9999 (highest layer, above everything)
 * - Dark/Light mode support
 * - **Rendered via Portal to document.body** (escapes parent stacking context)
 * 
 * Why Portal?
 * - Parent components with overflow/transform/filter create new stacking contexts
 * - Even z-9999 cannot escape parent's stacking context without Portal
 * - Portal renders directly to document.body, bypassing all parent constraints
 * 
 * Usage:
 * ```tsx
 * <Tooltip content="Hello World" placement="bottom">
 *   <button>Click me</button>
 * </Tooltip>
 * ```
 */
export const Tooltip: React.FC<TooltipProps> = ({
  children,
  content,
  placement = 'top',
  className = '',
  trigger = 'click',
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const tooltipId = useRef<string>(`tooltip-${Math.random().toString(36).substr(2, 9)}`);
  const hoverCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ✅ Subscribe to global tooltip state
  useEffect(() => {
    const listener = (activeId: string | null) => {
      if (activeId !== tooltipId.current) {
        setIsVisible(false);
      }
    };
    
    tooltipListeners.add(listener);
    return () => {
      tooltipListeners.delete(listener);
    };
  }, []);

  const toggleTooltip = (e: React.MouseEvent) => {
    e.stopPropagation();

    if (isVisible) {
      // Close this tooltip
      setIsVisible(false);
      setActiveTooltip(null);
    } else {
      // Close any other tooltip and open this one
      setActiveTooltip(tooltipId.current);
      setIsVisible(true);
      // Will update position after render
      setTimeout(() => updatePosition(), 0);
    }
  };

  const openHover = () => {
    if (hoverCloseTimer.current) {
      clearTimeout(hoverCloseTimer.current);
      hoverCloseTimer.current = null;
    }
    if (isVisible) return;
    setActiveTooltip(tooltipId.current);
    setIsVisible(true);
    setTimeout(() => updatePosition(), 0);
  };

  const scheduleHoverClose = () => {
    if (hoverCloseTimer.current) clearTimeout(hoverCloseTimer.current);
    // Short delay lets the pointer traverse the gap/arrow into the tooltip
    // body without flicker. The tooltip body itself cancels the timer on
    // mouseenter to keep it open while interacting.
    hoverCloseTimer.current = setTimeout(() => {
      setIsVisible(false);
      setActiveTooltip(null);
      hoverCloseTimer.current = null;
    }, 150);
  };

  useEffect(() => {
    return () => {
      if (hoverCloseTimer.current) clearTimeout(hoverCloseTimer.current);
    };
  }, []);

  const updatePosition = () => {
    if (!triggerRef.current || !tooltipRef.current) return;

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();

    let top = 0;
    let left = 0;

    switch (placement) {
      case 'top':
        top = triggerRect.top - tooltipRect.height - 8;
        left = triggerRect.left + (triggerRect.width - tooltipRect.width) / 2;
        break;
      case 'bottom':
        top = triggerRect.bottom + 8;
        left = triggerRect.left + (triggerRect.width - tooltipRect.width) / 2;
        break;
      case 'left':
        top = triggerRect.top + (triggerRect.height - tooltipRect.height) / 2;
        left = triggerRect.left - tooltipRect.width - 8;
        break;
      case 'right':
        top = triggerRect.top + (triggerRect.height - tooltipRect.height) / 2;
        left = triggerRect.right + 8;
        break;
    }

    // Viewport boundary checks
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Horizontal boundaries
    if (left < 8) {
      left = 8;
    } else if (left + tooltipRect.width > viewportWidth - 8) {
      left = viewportWidth - tooltipRect.width - 8;
    }

    // Vertical boundaries
    if (top < 8) {
      top = 8;
    } else if (top + tooltipRect.height > viewportHeight - 8) {
      top = viewportHeight - tooltipRect.height - 8;
    }

    setPosition({ top, left });
  };

  // Close on click outside — click mode only. Hover mode relies on
  // mouseleave + close-timer; binding a click-outside listener in hover
  // mode would close the tooltip the moment the user clicks anywhere
  // inside it.
  useEffect(() => {
    if (!isVisible) return;
    if (trigger !== 'click') return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        tooltipRef.current &&
        !tooltipRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setIsVisible(false);
        setActiveTooltip(null);
      }
    };

    // Small delay to avoid immediate close on the same click that opened it
    const timeoutId = setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('click', handleClickOutside);
    };
  }, [isVisible, trigger]);

  // Update position on resize/scroll
  useEffect(() => {
    if (isVisible) {
      updatePosition();
      window.addEventListener('resize', updatePosition);
      window.addEventListener('scroll', updatePosition, true);
      return () => {
        window.removeEventListener('resize', updatePosition);
        window.removeEventListener('scroll', updatePosition, true);
      };
    }
  }, [isVisible]);

  const isHover = trigger === 'hover';

  // ✅ Render tooltip content (will be portaled to document.body)
  const tooltipContent = isVisible && (
    <div
      ref={tooltipRef}
      onMouseEnter={isHover ? openHover : undefined}
      onMouseLeave={isHover ? scheduleHoverClose : undefined}
      className={`fixed z-[9999] px-3 py-2 text-sm rounded-lg shadow-2xl transition-opacity duration-200 whitespace-normal ${className}
        bg-amber-50
        text-[color:var(--text-1)]
        border-2 border-amber-300`}
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
    >
      {content}
      <div
        className={`absolute w-2 h-2 transform rotate-45 ${getArrowPositionClass(placement)}
          bg-amber-50 
          border-amber-300`}
        style={getArrowBorderStyle(placement)}
      />
    </div>
  );

  return (
    <>
      <div
        ref={triggerRef}
        onClick={isHover ? undefined : toggleTooltip}
        onMouseEnter={isHover ? openHover : undefined}
        onMouseLeave={isHover ? scheduleHoverClose : undefined}
        style={{ display: 'inline-flex', alignItems: 'center', cursor: isHover ? 'default' : 'pointer' }}
      >
        {children}
      </div>

      {/* ✅ Portal: Render tooltip directly to document.body (escapes parent stacking context) */}
      {tooltipContent && createPortal(tooltipContent, document.body)}
    </>
  );
};

function getArrowPositionClass(placement: string): string {
  switch (placement) {
    case 'top':
      return 'bottom-[-4px] left-1/2 -translate-x-1/2';
    case 'bottom':
      return 'top-[-4px] left-1/2 -translate-x-1/2';
    case 'left':
      return 'right-[-4px] top-1/2 -translate-y-1/2';
    case 'right':
      return 'left-[-4px] top-1/2 -translate-y-1/2';
    default:
      return '';
  }
}

function getArrowBorderStyle(placement: string): React.CSSProperties {
  // Arrow border to match tooltip border
  switch (placement) {
    case 'top':
      return {
        borderRight: '1px solid',
        borderBottom: '1px solid',
        borderColor: 'inherit',
      };
    case 'bottom':
      return {
        borderLeft: '1px solid',
        borderTop: '1px solid',
        borderColor: 'inherit',
      };
    case 'left':
      return {
        borderTop: '1px solid',
        borderRight: '1px solid',
        borderColor: 'inherit',
      };
    case 'right':
      return {
        borderBottom: '1px solid',
        borderLeft: '1px solid',
        borderColor: 'inherit',
      };
    default:
      return {};
  }
}

