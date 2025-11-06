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
}

const VARIANT_STYLES: Record<ChipVariant, {
  dotColor: string;
  textColor: string;
  pulse?: boolean;
}> = {
  live: {
    dotColor: 'bg-green-500',
    textColor: 'text-green-600 dark:text-green-400',
    pulse: true
  },
  session: {
    dotColor: 'bg-gray-400 dark:bg-gray-500',
    textColor: 'text-gray-600 dark:text-gray-400'
  },
  estimating: {
    dotColor: 'bg-blue-500',
    textColor: 'text-blue-600 dark:text-blue-400',
    pulse: true
  },
  success: {
    dotColor: 'bg-green-500',
    textColor: 'text-green-600 dark:text-green-400'
  },
  warning: {
    dotColor: 'bg-orange-500',
    textColor: 'text-orange-600 dark:text-orange-400'
  },
  error: {
    dotColor: 'bg-red-500',
    textColor: 'text-red-600 dark:text-red-400'
  },
  info: {
    dotColor: 'bg-blue-500',
    textColor: 'text-blue-600 dark:text-blue-400'
  },
  neutral: {
    dotColor: 'bg-gray-400 dark:bg-gray-500',
    textColor: 'text-gray-600 dark:text-gray-400'
  }
};

/**
 * StatusChip Component
 */
export function StatusChip({ 
  variant = 'neutral', 
  label, 
  icon,
  pulse 
}: StatusChipProps) {
  const style = VARIANT_STYLES[variant];
  const shouldPulse = pulse !== undefined ? pulse : style.pulse;

  return (
    <div className="flex items-center gap-2 px-2 h-7 rounded-md bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700">
      <div className="flex items-center gap-1.5">
        {icon ? (
          // 커스텀 아이콘 사용
          <span className={style.textColor}>{icon}</span>
        ) : (
          // 기본 도트 표시
          shouldPulse ? (
            <span className="relative flex h-2 w-2">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${style.dotColor.replace('bg-', 'bg-').replace('-500', '-400')} opacity-75`}></span>
              <span className={`relative inline-flex rounded-full h-2 w-2 ${style.dotColor}`}></span>
            </span>
          ) : (
            <span className={`inline-flex h-2 w-2 rounded-full ${style.dotColor}`}></span>
          )
        )}
        <span className={`text-xs font-medium ${style.textColor} leading-none`}>
          {label}
        </span>
      </div>
    </div>
  );
}

