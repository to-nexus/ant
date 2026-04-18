export default {
  darkMode: 'class', // Enable class-based dark mode
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}'
  ],
  theme: {
    containers: {
      xs: '280px',
      sm: '420px',
      md: '640px',
      lg: '900px',
    },
    extend: {
      fontFamily: {
        'display': ['Space Grotesk', 'system-ui', 'sans-serif'],
      },
      typography: {
        DEFAULT: {
          css: {
            'code::before': { content: 'none' },
            'code::after': { content: 'none' },
          },
        },
      },
      colors: {
        // Primary Brand Colors
        primary: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
          950: '#082f49'
        },
        
        // Extended Gray Palette
        gray: {
          850: '#1a202c'  // gray-850 (between 800 and 900)
        },
        
        // Semantic Colors for Task Status
        status: {
          todo: {
            light: '#3b82f6',      // blue-500
            dark: '#60a5fa',       // blue-400
            bg: {
              light: '#eff6ff',    // blue-50
              dark: '#1e3a8a'      // blue-900
            }
          },
          progress: {
            light: '#f97316',      // orange-500
            dark: '#fb923c',       // orange-400
            bg: {
              light: '#fff7ed',    // orange-50
              dark: '#7c2d12'      // orange-900
            }
          },
          completed: {
            light: '#22c55e',      // green-500
            dark: '#4ade80',       // green-400
            bg: {
              light: '#f0fdf4',    // green-50
              dark: '#14532d'      // green-900
            }
          }
        },
        
        // Semantic UI Colors (GitHub/VS Code inspired)
        ui: {
          bg: {
            // App 최하위 배경 (body)
            base: {
              light: '#f6f8fa',    // 약간 회색빛 (GitHub style)
              dark: '#0d1117'      // 매우 어두운 회색
            },
            // 메인 카드/패널 배경 (MainPanel boards)
            primary: {
              light: '#ffffff',    // 순백 (카드처럼 떠보이게)
              dark: '#161b22'      // dark gray-900
            },
            // 사이드바/보조 영역 (Explorer)
            secondary: {
              light: '#f8f9fa',    // 조금 더 밝은 회색
              dark: '#1f2937'      // gray-800
            },
            // 중첩된 요소 (Explorer 내부)
            tertiary: {
              light: '#ffffff',    // 순백
              dark: '#374151'      // gray-700
            },
            // 호버/활성 상태
            hover: {
              light: '#f3f4f6',    // gray-100
              dark: '#30363d'      // 약간 밝은 회색
            }
          },
          text: {
            primary: {
              light: '#111827',    // gray-900
              dark: '#f9fafb'      // gray-50
            },
            secondary: {
              light: '#4b5563',    // gray-600
              dark: '#d1d5db'      // gray-300
            },
            tertiary: {
              light: '#6b7280',    // gray-500
              dark: '#9ca3af'      // gray-400
            },
            muted: {
              light: '#9ca3af',    // gray-400
              dark: '#6b7280'      // gray-500
            }
          },
          border: {
            subtle: {
              light: '#e5e7eb',    // gray-200 - 미묘한 경계선
              dark: '#30363d'      // 어두운 회색
            },
            normal: {
              light: '#d1d5db',    // gray-300 - 일반 경계선
              dark: '#374151'      // gray-700
            },
            emphasis: {
              light: '#9ca3af',    // gray-400 - 강조 경계선
              dark: '#4b5563'      // gray-600
            }
          },
          // Legacy support
          border_strong: {
            light: '#d1d5db',      // gray-300
            dark: '#4b5563'        // gray-600
          }
        },
        
        // Badge & Tag Colors
        badge: {
          feature: {
            light: '#3b82f6',
            dark: '#60a5fa',
            bg: { light: '#dbeafe', dark: '#1e3a8a' }
          },
          setup: {
            light: '#8b5cf6',
            dark: '#a78bfa',
            bg: { light: '#ede9fe', dark: '#5b21b6' }
          },
          error: {
            light: '#ef4444',
            dark: '#f87171',
            bg: { light: '#fee2e2', dark: '#7f1d1d' }
          },
          final: {
            light: '#10b981',
            dark: '#34d399',
            bg: { light: '#d1fae5', dark: '#065f46' }
          }
        }
      },
      keyframes: {
        wiggle: {
          '0%, 100%': { transform: 'rotate(-10deg)' },
          '50%': { transform: 'rotate(10deg)' }
        },
        gradient: {
          '0%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
          '100%': { backgroundPosition: '0% 50%' }
        },
        shine: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' }
        },
        // ✅ Flash animation for completed tasks
        flash: {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '25%': { opacity: '0.7', transform: 'scale(1.02)' },
          '50%': { opacity: '1', transform: 'scale(1)' },
          '75%': { opacity: '0.8', transform: 'scale(1.01)' }
        },
        // ✅ Gentle pulse for chat ready state
        'pulse-gentle': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.7', transform: 'scale(1.05)' }
        },
        // ✅ Gentle bounce for chat ready state
        'bounce-gentle': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-5px)' }
        },
        // ✨ Sparkle float - 뚱뚱해졌다 홀쭉해지는 효과 (크기 + 불투명도만)
        'sparkle-float': {
          '0%, 100%': { 
            opacity: '1', 
            transform: 'scale(1)' 
          },
          '50%': { 
            opacity: '0.75', 
            transform: 'scale(1.25)' 
          }
        },
        // 💬 Typing indicator dots - 순차적 펄싱
        'typing-dot': {
          '0%, 60%, 100%': { 
            opacity: '0.3',
            transform: 'scale(0.8)'
          },
          '30%': { 
            opacity: '1',
            transform: 'scale(1)'
          }
        },
        // ✨ Glow rotation for QuickStart input border
        'glow-spin': {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' }
        },
        // 🍞 Toast slide in from right
        'toast-in': {
          '0%': { transform: 'translateX(100%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' }
        },
        // 🍞 Toast slide out to right
        'toast-out': {
          '0%': { transform: 'translateX(0)', opacity: '1' },
          '100%': { transform: 'translateX(100%)', opacity: '0' }
        },
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        fadeOut: {
          '0%': { opacity: '1' },
          '100%': { opacity: '0' }
        },
        slideDown: {
          '0%': { opacity: '0', transform: 'translateY(-8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        // Async UI Policy — ambient progress indicator (indeterminate bar)
        'ambient-progress': {
          '0%':   { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(300%)' }
        },
        // Domain "live / active" dot indicator. Visually identical to
        // tailwind's default animate-pulse but lives under a different name
        // so the ESLint guard against animate-pulse (loading-only) does not
        // false-positive on domain indicators (StatusChip, active steps).
        'status-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.5' }
        },
        // Domain "gear turning" indicator for workflow/kanban nodes. Same
        // behaviour as tailwind's animate-spin but named so the ESLint
        // guard (loading-only animate-spin) does not false-positive.
        'cog-spin': {
          from: { transform: 'rotate(0deg)' },
          to:   { transform: 'rotate(360deg)' }
        }
      },
      animation: {
        gradient: 'gradient 2s ease infinite',
        shine: 'shine 0.8s ease-in-out',
        flash: 'flash 0.6s ease-in-out',
        'pulse-gentle': 'pulse-gentle 2.5s ease-in-out infinite',
        'bounce-gentle': 'bounce-gentle 2s ease-in-out infinite',
        'sparkle-float': 'sparkle-float 3s ease-in-out infinite',
        'typing-dot': 'typing-dot 1.4s ease-in-out infinite',
        'glow-spin': 'glow-spin 3s linear infinite',
        'toast-in': 'toast-in 0.3s ease-out forwards',
        'toast-out': 'toast-out 0.25s ease-in forwards',
        fadeIn: 'fadeIn 0.2s ease-out',
        fadeOut: 'fadeOut 0.15s ease-in',
        slideDown: 'slideDown 0.25s ease-out',
        'ambient-progress': 'ambient-progress 1.2s ease-in-out infinite',
        'status-pulse': 'status-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'cog-spin': 'cog-spin 1.5s linear infinite'
      }
    }
  },
  plugins: [
    require('@tailwindcss/typography'),
    require('@tailwindcss/container-queries'),
    // ✅ 스크롤바 숨김 유틸리티
    function({ addUtilities }) {
      addUtilities({
        '.scrollbar-hide': {
          /* Firefox */
          'scrollbar-width': 'none',
          /* Safari and Chrome */
          '&::-webkit-scrollbar': {
            display: 'none'
          }
        }
      })
    }
  ]
};