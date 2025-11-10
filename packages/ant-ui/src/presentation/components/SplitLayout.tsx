import { ReactNode, useState, useEffect, useRef } from 'react';
import { cn } from '@/shared/utils/design-system';

interface SplitLayoutProps {
  /**
   * First panel content
   */
  first: ReactNode;
  
  /**
   * Second panel content
   */
  second: ReactNode;
  
  /**
   * Split direction
   */
  direction: 'horizontal' | 'vertical';
  
  /**
   * Initial split ratio (0-1, default 0.5)
   */
  initialRatio?: number;
  
  /**
   * Minimum size for each panel (in pixels)
   * Default: 50px (compact header only: py-2 padding + text-sm + border + resizer)
   * Calculation: 8px + 8px + ~20px + 1px + 4px + margin ≈ 50px
   */
  minSize?: number;
}

/**
 * SplitLayout - Resizable split pane layout
 * 
 * Features:
 * - Horizontal (left/right) or vertical (top/bottom) split
 * - Draggable resizer
 * - Customizable initial ratio
 * - Minimum panel size constraints
 * - Independent scrolling for each panel
 * 
 * Similar to IDE editor split views (VS Code, IntelliJ)
 */
export function SplitLayout({
  first,
  second,
  direction,
  initialRatio = 0.5,
  minSize = 50,
}: SplitLayoutProps) {
  const [ratio, setRatio] = useState(initialRatio);
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const isHorizontal = direction === 'horizontal';
  
  // 각 보드의 최소 너비/높이
  // 좌우 분할(horizontal): Task Board 헤더 모든 요소가 보이는 크기 (600px)
  // 상하 분할(vertical): 헤더 높이만 (50px)
  const MIN_BOARD_WIDTH = 600; // 헤더 모든 요소가 보이는 너비
  const MIN_BOARD_HEIGHT = 40; // 헤더 높이만 (Bar h-10 + padding + border)

  // Handle mouse resize
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !containerRef.current) return;

      const container = containerRef.current;
      const rect = container.getBoundingClientRect();

      let newRatio: number;
      if (isHorizontal) {
        // Horizontal: left/right
        const mouseX = e.clientX - rect.left;
        newRatio = mouseX / rect.width;
      } else {
        // Vertical: top/bottom
        const mouseY = e.clientY - rect.top;
        newRatio = mouseY / rect.height;
      }

      // Apply min/max constraints
      const containerSize = isHorizontal ? rect.width : rect.height;
      
      // 동적으로 최소 크기 계산 (분할 방향에 따라 다름)
      // 좌우 분할: MIN_BOARD_WIDTH 사용, 작은 화면 대응
      // 상하 분할: MIN_BOARD_HEIGHT 사용 (헤더 높이만)
      const minBoardSize = isHorizontal ? MIN_BOARD_WIDTH : MIN_BOARD_HEIGHT;
      const effectiveMinSize = isHorizontal 
        ? Math.min(minBoardSize, containerSize * 0.3) // 좌우: 최소 30%
        : minBoardSize; // 상하: 고정 헤더 높이
      
      const minRatio = effectiveMinSize / containerSize;
      const maxRatio = 1 - minRatio;

      // 최소/최대 비율이 유효한지 확인 (작은 화면 대응)
      if (minRatio >= 0.5) {
        // 화면이 너무 작아서 분할이 불가능한 경우, 50:50 유지
        return;
      }

      newRatio = Math.max(minRatio, Math.min(maxRatio, newRatio));
      setRatio(newRatio);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = isHorizontal ? 'ew-resize' : 'ns-resize';
      document.body.style.userSelect = 'none';
    } else {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, isHorizontal, minSize]);

  // ✅ For horizontal split, maintain fixed width ratio (not affected by height changes)
  const firstPanelStyle = isHorizontal
    ? { width: `${ratio * 100}%` }
    : { height: `${ratio * 100}%` };

  const secondPanelStyle = isHorizontal
    ? { width: `${(1 - ratio) * 100}%` }
    : { height: `${(1 - ratio) * 100}%` };

  return (
    <div
      ref={containerRef}
      className={cn(
        'flex w-full h-full',
        isHorizontal ? 'flex-row' : 'flex-col'
      )}
    >
      {/* First Panel */}
      <div
        className="overflow-hidden"
        style={firstPanelStyle}
      >
        <div className="h-full overflow-y-auto">
          {first}
        </div>
      </div>

      {/* Resizer */}
      <div
        className={cn(
          'shrink-0 relative group',
          isHorizontal ? 'w-1 cursor-ew-resize' : 'h-1 cursor-ns-resize',
          'bg-gray-300 dark:bg-gray-600',
          'hover:bg-blue-400 dark:hover:bg-blue-600',
          'transition-colors duration-150',
          isResizing && 'bg-blue-500 dark:bg-blue-500'
        )}
        onMouseDown={() => setIsResizing(true)}
        title={isHorizontal ? 'Drag to resize horizontally' : 'Drag to resize vertically'}
      >
        {/* Visual indicator on hover */}
        <div
          className={cn(
            'absolute inset-0',
            'transition-all duration-150',
            isHorizontal
              ? 'group-hover:w-1.5 group-hover:-left-0.25'
              : 'group-hover:h-1.5 group-hover:-top-0.25',
            isResizing && (isHorizontal ? 'w-1.5 -left-0.25' : 'h-1.5 -top-0.25')
          )}
        />
      </div>

      {/* Second Panel */}
      <div
        className="overflow-hidden"
        style={secondPanelStyle}
      >
        <div className="h-full overflow-y-auto">
          {second}
        </div>
      </div>
    </div>
  );
}

