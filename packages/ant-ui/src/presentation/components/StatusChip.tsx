/**
 * StatusChip - 공통 상태 표시 칩 컴포넌트
 * 
 * 다양한 상태를 시각적으로 표시하는 재사용 가능한 컴포넌트
 * 
 * Examples:
 * - Data source (Real-time, Session File, Estimating)
 * - Agent type (architect, code, design)
 * - Job status (running, completed, paused)
 */

export type ChipVariant = 
  | 'live'           // 실시간 (초록색, 펄스)
  | 'session'        // 세션 파일 (회색)
  | 'estimating'     // 예측중 (파란색, 펄스)
  | 'success'        // 성공 (초록색)
  | 'warning'        // 경고 (주황색)
  | 'error'          // 에러 (빨간색)
  | 'info'           // 정보 (파란색)
  | 'neutral';       // 중립 (회색)

interface StatusChipProps {
  variant?: ChipVariant;
  label: string;
  icon?: React.ReactNode;
  pulse?: boolean;  // 펄스 애니메이션 강제 활성화/비활성화
  hideDot?: boolean;  // dot 아이콘 숨기기
}

const VARIANT_STYLES: Record<ChipVariant, {
  dotColor: string;
  textColor: string;
  pulse?: boolean;
}> = {
  live: {
    dotColor: 'var(--status-done-fg)',
    textColor: 'var(--status-done-fg)',
    pulse: true
  },
  session: {
    dotColor: 'var(--text-3)',
    textColor: 'var(--text-3)'
  },
  estimating: {
    dotColor: 'var(--violet-500)',
    textColor: 'var(--violet-500)',
    pulse: true
  },
  success: {
    dotColor: 'var(--status-done-fg)',
    textColor: 'var(--status-done-fg)'
  },
  warning: {
    dotColor: 'var(--orange-500)',
    textColor: 'var(--orange-500)'
  },
  error: {
    dotColor: 'var(--red-500)',
    textColor: 'var(--red-500)'
  },
  info: {
    dotColor: 'var(--violet-500)',
    textColor: 'var(--violet-500)'
  },
  neutral: {
    dotColor: 'var(--text-3)',
    textColor: 'var(--text-3)'
  }
};

/**
 * StatusChip Component
 */
export function StatusChip({ 
  variant = 'neutral', 
  label, 
  icon,
  pulse,
  hideDot = false
}: StatusChipProps) {
  const style = VARIANT_STYLES[variant];
  const shouldPulse = pulse !== undefined ? pulse : style.pulse;

  return (
    <div
      className="flex items-center gap-2 px-2 h-7 rounded-md"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-1)',
      }}
    >
      <div className={`flex items-center gap-1.5 ${shouldPulse ? 'animate-status-pulse' : ''}`}>
        {icon ? (
          // 커스텀 아이콘 사용
          <span style={{ color: style.textColor }}>{icon}</span>
        ) : hideDot ? (
          // dot 숨김 (텍스트만)
          null
        ) : (
          // 기본 도트 표시
          shouldPulse ? (
            <span className="relative flex h-2 w-2">
              <span
                className="animate-ping absolute inline-flex h-full w-full rounded-full"
                style={{ background: style.dotColor, opacity: 0.75 }}
              ></span>
              <span
                className="relative inline-flex rounded-full h-2 w-2"
                style={{ background: style.dotColor }}
              ></span>
            </span>
          ) : (
            <span
              className="inline-flex h-2 w-2 rounded-full"
              style={{ background: style.dotColor }}
            ></span>
          )
        )}
        <span
          className="text-xs font-medium leading-none"
          style={{ color: style.textColor }}
        >
          {label}
        </span>
      </div>
    </div>
  );
}

